import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeCnpj, HttpError } from "./analyze-cnpj.mjs";
import { generateIntelligenceReport } from "./ai-synthesis.mjs";
import { runPgfnSyncJob } from "./pgfn-sync.mjs";
import { recoverStaleJobRuns, getPgfnSourceStatus } from "./source-index-store.mjs";
import { PGFN_SOURCE_IDS } from "./source-registry.mjs";
import {
  createSearchQuery,
  getSearchQueryById,
  listSearchQueries,
  updateSearchQueryResult,
} from "./investigation-store.mjs";
import {
  getInvestigationEventsFeed,
  getInvestigationGraphData,
  getInvestigationJudicialCoverageData,
  getInvestigationJudicialProcessesData,
  getInvestigationJudicialSummaryData,
  getInvestigationStatus,
  recoverAndResumeInvestigations,
} from "./investigation-orchestrator.mjs";
import { calculateScore } from "./risk-scoring.mjs";
import { SOURCE_REGISTRY } from "./source-registry.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const distDir = path.join(projectRoot, "dist");
const port = Number.parseInt(process.env.PORT ?? "3000", 10);
const JOB_ADMIN_TOKEN = (process.env.JOB_ADMIN_TOKEN ?? "").trim();
let pgfnSyncInFlight = null;

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function normalizeCnpj(value) {
  return String(value ?? "")
    .replace(/\D/g, "")
    .slice(0, 14);
}

function attachSearchMeta(result, searchMeta = {}) {
  if (!result || typeof result !== "object") return result;
  const next = { ...result };
  const currentMeta = next.meta && typeof next.meta === "object" ? next.meta : {};
  next.meta = { ...currentMeta, ...searchMeta };
  return next;
}

function isFinalInvestigationStatus(status) {
  return (
    status === "completed" ||
    status === "partial" ||
    status === "failed" ||
    status === "budget_exceeded"
  );
}

function buildAiPendingReason(runId, status) {
  const suffix = runId ? ` (run_id: ${runId})` : "";
  if (status === "queued" || status === "running") {
    return `Laudo GenAI pendente: investigação profunda em andamento${suffix}.`;
  }
  return `Laudo GenAI pendente: aguardando conclusão da investigação profunda${suffix}.`;
}

const DEEP_RECONCILIATION_VERSION = "2026.02.27.4";

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function severityRank(value) {
  const normalized = String(value ?? "").toLowerCase();
  if (normalized === "critical") return 4;
  if (normalized === "high") return 3;
  if (normalized === "medium") return 2;
  return 1;
}

function sourceLabelFromId(sourceId) {
  const sourceKey = String(sourceId ?? "").trim();
  if (!sourceKey) return "Investigação profunda";
  if (SOURCE_REGISTRY[sourceKey]?.name) return SOURCE_REGISTRY[sourceKey].name;

  const connectorMap = {
    esaj: "Crawler ESAJ (Tribunais)",
    pje: "Crawler PJe (Tribunais)",
    eproc: "Crawler eproc (Tribunais)",
    projudi: "Crawler Projudi (Tribunais)",
    datajud: "DataJud — Processos Judiciais (CNJ)",
    judicial_crawler: "Crawler Judicial Nacional (Tribunais)",
    network: "Análise de Padrões de Rede Societária",
  };
  return connectorMap[sourceKey] ?? sourceKey;
}

function normalizeVerificationStatus(value) {
  const normalized = String(value ?? "").toLowerCase();
  if (normalized === "possible") return "possible";
  if (normalized === "probable") return "probable";
  return "objective";
}

function buildSummaryText(classification, flags, companyName) {
  const safeName = String(companyName ?? "empresa");
  const totalFlags = Array.isArray(flags) ? flags.length : 0;
  if (totalFlags === 0) {
    return `A empresa ${safeName} não apresenta registros negativos nas bases consultadas. Risco considerado baixo.`;
  }

  const recommendations = {
    Baixo: "Monitoramento periódico recomendado.",
    Médio: "Recomenda-se diligência complementar e validações adicionais.",
    Alto: "Alto risco identificado. Recomenda-se cautela extrema e due diligence completa.",
    Crítico: "Risco crítico identificado. Recomenda-se bloqueio até análise jurídica especializada.",
  };

  const topFlags = [...flags]
    .sort((a, b) => {
      const bySeverity = severityRank(b?.severity) - severityRank(a?.severity);
      if (bySeverity !== 0) return bySeverity;
      return Number(b?.weight ?? 0) - Number(a?.weight ?? 0);
    })
    .slice(0, 5)
    .map((flag) => flag.title)
    .filter(Boolean);
  const listed = [...new Set(topFlags)].join(", ");
  return `A empresa ${safeName} apresenta ${totalFlags} alerta(s): ${listed}. ${recommendations[classification] ?? ""}`;
}

function extractYearFromDateLike(value) {
  if (!value) return null;
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return String(value.getUTCFullYear());
  }
  const parsed = new Date(value);
  if (Number.isFinite(parsed.getTime())) {
    return String(parsed.getUTCFullYear());
  }
  const text = String(value);
  const match = text.match(/\b(19|20)\d{2}\b/);
  return match ? match[0] : null;
}

function mapDeepFindingsToFlags(graph) {
  if (!graph || !Array.isArray(graph.nodes)) return [];
  const byFindingId = new Map();

  for (const node of graph.nodes) {
    const nodeDepth = Number(node?.depth ?? 0);
    const nodeCnpj =
      node?.metadata && typeof node.metadata === "object" && typeof node.metadata.cnpj === "string"
        ? node.metadata.cnpj
        : null;
    const findings = Array.isArray(node?.findings) ? node.findings : [];
    for (const finding of findings) {
      const findingKey = String(finding?.finding_id ?? finding?.id ?? "").trim();
      if (!findingKey || byFindingId.has(findingKey)) continue;
      const sourceId = finding?.source_id ?? null;
      const evidence = Array.isArray(finding?.evidence) ? [...finding.evidence] : [];

      if (nodeDepth > 0) {
        if (nodeCnpj) evidence.unshift({ label: "CNPJ da entidade relacionada", value: nodeCnpj });
        if (node?.label) {
          evidence.unshift({
            label: "Entidade na cadeia societária",
            value: `${node.label} (depth=${nodeDepth})`,
          });
        }
      }

      byFindingId.set(findingKey, {
        id: findingKey,
        source: sourceLabelFromId(sourceId),
        source_id: sourceId,
        severity: String(finding?.severity ?? "low").toLowerCase(),
        title: String(finding?.title ?? finding?.id ?? "Alerta de risco"),
        description: String(finding?.description ?? ""),
        weight: Number(finding?.weight ?? 0),
        depth: Number.isFinite(Number(finding?.depth)) ? Number(finding.depth) : nodeDepth,
        confidence_level: finding?.confidence_level ?? null,
        confidence:
          finding?.confidence == null || Number.isNaN(Number(finding.confidence))
            ? null
            : Number(finding.confidence),
        verification_status: normalizeVerificationStatus(finding?.verification_status),
        evidence,
      });
    }
  }

  return [...byFindingId.values()].sort((a, b) => {
    const bySeverity = severityRank(b.severity) - severityRank(a.severity);
    if (bySeverity !== 0) return bySeverity;
    const byWeight = Number(b.weight ?? 0) - Number(a.weight ?? 0);
    if (byWeight !== 0) return byWeight;
    return String(a.title ?? "").localeCompare(String(b.title ?? ""));
  });
}

function computeDatajudEnrichment(coverageItems) {
  let attempted = 0;
  let enriched = 0;
  let failed = 0;
  let unavailable = 0;

  for (const item of Array.isArray(coverageItems) ? coverageItems : []) {
    const metadata = isObject(item?.metadata) ? item.metadata : {};
    const enrichment = isObject(metadata?.datajud_enrichment) ? metadata.datajud_enrichment : null;
    if (!enrichment) continue;
    attempted += Number(enrichment.attempted ?? 0) || 0;
    enriched += Number(enrichment.enriched ?? 0) || 0;
    failed += Number(enrichment.failed ?? 0) || 0;
    unavailable += Number(enrichment.unavailable ?? 0) || 0;
  }

  return { attempted, enriched, failed, unavailable };
}

function upsertSource(sources, sourceId, patch) {
  const list = Array.isArray(sources) ? [...sources] : [];
  const index = list.findIndex((item) => item?.id === sourceId);
  if (index >= 0) {
    list[index] = { ...list[index], ...patch, id: sourceId };
    return list;
  }

  list.push({
    id: sourceId,
    name: SOURCE_REGISTRY[sourceId]?.name ?? sourceId,
    status: "unavailable",
    ...patch,
  });
  return list;
}

function syncJudicialSources(payload, deepSummary, judicialCoverage) {
  const next = { ...payload };
  const summary = deepSummary?.judicial_scan ?? null;
  const status = deepSummary?.status ?? null;
  const coverageItems = Array.isArray(judicialCoverage?.items) ? judicialCoverage.items : [];

  const consulted = Number(summary?.consulted ?? 0) || 0;
  const supported = Number(summary?.supported ?? 0) || 0;
  const unavailable = Number(summary?.unavailable ?? 0) || 0;
  const foundProcesses = Number(summary?.found_processes ?? 0) || 0;
  const matchedTribunals = Number(summary?.matched_tribunals ?? 0) || 0;

  let judicialStatus = "running";
  let judicialReason = "queued_async";
  let judicialMessage = "Varredura judicial em andamento";

  if (isFinalInvestigationStatus(status)) {
    if (foundProcesses > 0) {
      judicialStatus = "success";
      judicialReason = "match_found";
      judicialMessage = `${foundProcesses} processo(s) encontrado(s) em ${matchedTribunals || 1} tribunal(is).`;
    } else if (consulted > 0 && unavailable >= consulted) {
      judicialStatus = "unavailable";
      judicialReason = "no_tribunal_response";
      judicialMessage = "Nenhum tribunal respondeu de forma consultável nesta execução.";
    } else if (unavailable > 0) {
      judicialStatus = "unavailable";
      judicialReason = "partial_coverage_no_match";
      judicialMessage =
        `Cobertura parcial sem match confirmado (${consulted - unavailable}/${supported} consultáveis).`;
    } else {
      judicialStatus = "not_found";
      judicialReason = "not_listed";
      judicialMessage = "Tribunais consultados sem processos para a entidade.";
    }
  }

  next.sources = upsertSource(next.sources, "judicial_crawler", {
    name: SOURCE_REGISTRY.judicial_crawler?.name ?? "Crawler Judicial Nacional (Tribunais)",
    status: judicialStatus,
    status_reason: judicialReason,
    message: judicialMessage,
    evidence_count: foundProcesses,
  });

  const enrichment = computeDatajudEnrichment(coverageItems);
  let datajudStatus = "running";
  let datajudReason = "deferred_to_crawler";
  let datajudMessage = "DataJud será usado para enriquecer processos encontrados no crawler.";

  if (isFinalInvestigationStatus(status)) {
    if (foundProcesses === 0) {
      datajudStatus = "unavailable";
      datajudReason = "deferred_to_crawler";
      datajudMessage = "Sem processos no crawler para enriquecimento DataJud.";
    } else if (enrichment.attempted === 0) {
      datajudStatus = "unavailable";
      datajudReason = "no_tribunal_response";
      datajudMessage = "Enriquecimento DataJud não executado para os processos encontrados.";
    } else if (enrichment.enriched > 0) {
      datajudStatus = enrichment.enriched === enrichment.attempted ? "success" : "unavailable";
      datajudReason = enrichment.enriched === enrichment.attempted ? "match_found" : "partial_coverage_no_match";
      datajudMessage =
        `DataJud enriquecido para ${enrichment.enriched}/${enrichment.attempted} processo(s)` +
        (enrichment.failed > 0 || enrichment.unavailable > 0
          ? ` (falhas: ${enrichment.failed}, indisponíveis: ${enrichment.unavailable})`
          : ".");
    } else {
      datajudStatus = "unavailable";
      datajudReason = "no_tribunal_response";
      datajudMessage = `DataJud processado sem retorno consultável (${enrichment.failed + enrichment.unavailable}/${enrichment.attempted}).`;
    }
  }

  next.sources = upsertSource(next.sources, "datajud", {
    name: SOURCE_REGISTRY.datajud?.name ?? "DataJud — Processos Judiciais (CNJ)",
    status: datajudStatus,
    status_reason: datajudReason,
    message: datajudMessage,
    evidence_count: enrichment.enriched,
  });

  return next;
}

function buildDeepReconciliationSignature(deepSummary) {
  if (!deepSummary || typeof deepSummary !== "object") return "";
  const runId = String(deepSummary.id ?? "");
  const status = String(deepSummary.status ?? "");
  const flagsCount = Number(deepSummary.flags_count ?? 0) || 0;
  const judicial = isObject(deepSummary.judicial_scan) ? deepSummary.judicial_scan : {};
  const foundProcesses = Number(judicial.found_processes ?? 0) || 0;
  const consulted = Number(judicial.consulted ?? 0) || 0;
  const unavailable = Number(judicial.unavailable ?? 0) || 0;
  return `${runId}:${status}:${flagsCount}:${foundProcesses}:${consulted}:${unavailable}`;
}

function hasDeepReconciliationUpToDate(payload, deepSummary) {
  if (!payload || typeof payload !== "object" || !deepSummary) return false;
  const meta = isObject(payload.meta) ? payload.meta : {};
  const marker = isObject(meta.deep_reconciliation) ? meta.deep_reconciliation : {};
  const signature = buildDeepReconciliationSignature(deepSummary);
  return (
    marker.version === DEEP_RECONCILIATION_VERSION &&
    marker.run_id === deepSummary.id &&
    marker.signature === signature
  );
}

async function reconcileResultWithDeepInvestigation(payload, deepSummary, deepRunId) {
  if (!payload || typeof payload !== "object") return { payload, changed: false };
  if (!deepRunId || !deepSummary || !isFinalInvestigationStatus(deepSummary?.status)) {
    return { payload, changed: false };
  }

  if (hasDeepReconciliationUpToDate(payload, deepSummary)) {
    return { payload, changed: false };
  }

  const [graph, judicialCoverage, judicialProcesses] = await Promise.all([
    getInvestigationGraphData(String(deepRunId)).catch(() => null),
    getInvestigationJudicialCoverageData(String(deepRunId)).catch(() => null),
    getInvestigationJudicialProcessesData(String(deepRunId)).catch(() => null),
  ]);

  const deepFlags = mapDeepFindingsToFlags(graph);
  const scoring = calculateScore(deepFlags);
  const companyName =
    payload.company && typeof payload.company === "object" && typeof payload.company.razao_social === "string"
      ? payload.company.razao_social
      : "empresa";

  let next = {
    ...payload,
    flags: deepFlags,
    score: scoring.score,
    classification: scoring.classification,
    summary: buildSummaryText(scoring.classification, deepFlags, companyName),
  };

  if (isObject(judicialProcesses) && Array.isArray(judicialProcesses.items) && judicialProcesses.items.length > 0) {
    next.judicial_processes = judicialProcesses.items.map((item) => ({
      tribunal: item.tribunal_name ?? item.tribunal_id,
      numeroProcesso: item.numero_processo,
      classe: item.classe ? { nome: item.classe } : null,
      assuntos: item.assunto
        ? String(item.assunto)
            .split(";")
            .map((value) => value.trim())
            .filter(Boolean)
            .map((nome) => ({ nome }))
        : [],
      dataAjuizamento: item.data_ajuizamento ?? null,
      ano: extractYearFromDateLike(item.data_ajuizamento),
      orgaoJulgador: item.orgao_julgador ? { nome: item.orgao_julgador } : null,
      valor: item.valor_causa ?? null,
      grau: null,
      polo:
        String(item.polo_empresa ?? "").toUpperCase() === "ATIVO"
          ? "ATIVO"
          : String(item.polo_empresa ?? "").toUpperCase() === "PASSIVO"
            ? "PASSIVO"
            : null,
      parteContraria: Array.isArray(item.parte_contraria) ? item.parte_contraria : [],
      andamentos: Array.isArray(item.andamentos) ? item.andamentos : [],
      sourceUrl: item.source_url ?? null,
    }));
  }

  next = syncJudicialSources(next, deepSummary, judicialCoverage);

  const currentMeta = isObject(next.meta) ? { ...next.meta } : {};
  currentMeta.deep_reconciliation = {
    run_id: deepSummary.id,
    version: DEEP_RECONCILIATION_VERSION,
    signature: buildDeepReconciliationSignature(deepSummary),
    synced_at: new Date().toISOString(),
  };
  next.meta = currentMeta;

  return { payload: next, changed: true };
}

function mergeDeepInvestigationMeta(result, deepSummary) {
  if (!result || typeof result !== "object") return result;
  const runId = deepSummary?.id ?? null;
  const status = deepSummary?.status ?? null;
  const judicial = deepSummary?.judicial_scan ?? null;

  const next = { ...result };
  const meta = next.meta && typeof next.meta === "object" ? { ...next.meta } : {};
  const currentDeep =
    meta.deep_investigation && typeof meta.deep_investigation === "object"
      ? { ...meta.deep_investigation }
      : {};
  const currentJudicial =
    meta.judicial_scan && typeof meta.judicial_scan === "object" ? { ...meta.judicial_scan } : {};

  if (runId) currentDeep.run_id = runId;
  if (status) currentDeep.status = status;
  if (currentDeep.auto_started === undefined) currentDeep.auto_started = true;
  meta.deep_investigation = currentDeep;

  if (judicial && typeof judicial === "object") {
    meta.judicial_scan = {
      run_id: runId ?? currentJudicial.run_id ?? null,
      status: status ?? currentJudicial.status ?? "running",
      consulted: judicial.consulted ?? currentJudicial.consulted ?? 0,
      supported: judicial.supported ?? currentJudicial.supported ?? 0,
      unavailable: judicial.unavailable ?? currentJudicial.unavailable ?? 0,
      found_processes: judicial.found_processes ?? currentJudicial.found_processes ?? 0,
    };
  }

  next.meta = meta;
  return next;
}

async function maybeGenerateFinalAiAnalysis(payload, deepSummary) {
  if (!payload || typeof payload !== "object") return payload;
  const runId = deepSummary?.id ?? null;
  const status = deepSummary?.status ?? null;
  if (!runId || !status) return payload;

  const aiAnalysis = payload.ai_analysis && typeof payload.ai_analysis === "object" ? payload.ai_analysis : null;
  const needsGeneration =
    !aiAnalysis ||
    aiAnalysis.available !== true ||
    String(aiAnalysis.reason ?? "").toLowerCase().includes("pendente");

  if (!needsGeneration) return payload;

  if (!isFinalInvestigationStatus(status)) {
    return {
      ...payload,
      ai_analysis: {
        available: false,
        reason: buildAiPendingReason(runId, status),
      },
    };
  }

  const generated = await generateIntelligenceReport({
    company: payload.company ?? {},
    flags: Array.isArray(payload.flags) ? payload.flags : [],
    sources: Array.isArray(payload.sources) ? payload.sources : [],
    score: typeof payload.score === "number" ? payload.score : 0,
    classification: payload.classification ?? "Baixo",
    partnerCompanies: payload?.related_entities?.partner_companies ?? null,
    pfPartnerResults: [],
  }).catch((error) => ({
    available: false,
    reason: error instanceof Error ? error.message : "Erro interno na síntese IA",
  }));

  return {
    ...payload,
    ai_analysis: generated,
  };
}

function setApiCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-job-token");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(body);
}

async function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";

    req.on("data", (chunk) => {
      body += chunk.toString("utf-8");
      if (body.length > 1_000_000) {
        reject(new HttpError(413, "Payload muito grande"));
      }
    });

    req.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new HttpError(400, "JSON inválido"));
      }
    });

    req.on("error", () => reject(new HttpError(400, "Falha ao ler request")));
  });
}

async function serveStatic(req, res, pathname) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    sendJson(res, 405, { error: "Método não permitido" });
    return;
  }

  let requestedPath = pathname === "/" ? "/index.html" : pathname;
  if (requestedPath.includes("\0")) {
    sendJson(res, 400, { error: "Path inválido" });
    return;
  }

  let filePath = path.normalize(path.join(distDir, requestedPath));
  if (!filePath.startsWith(distDir)) {
    sendJson(res, 403, { error: "Acesso negado" });
    return;
  }

  try {
    let stat = await fs.stat(filePath);
    if (stat.isDirectory()) {
      filePath = path.join(filePath, "index.html");
      stat = await fs.stat(filePath);
    }

    const ext = path.extname(filePath);
    const contentType = MIME_TYPES[ext] ?? "application/octet-stream";
    const content = await fs.readFile(filePath);
    res.writeHead(200, { "Content-Type": contentType, "Content-Length": stat.size });
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    res.end(content);
    return;
  } catch {
    try {
      const indexPath = path.join(distDir, "index.html");
      const indexContent = await fs.readFile(indexPath);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      if (req.method === "HEAD") {
        res.end();
        return;
      }
      res.end(indexContent);
      return;
    } catch {
      sendJson(res, 500, { error: "Build do frontend não encontrado. Rode `npm run build`." });
      return;
    }
  }
}

function requireJobToken(req, res) {
  if (!JOB_ADMIN_TOKEN) {
    sendJson(res, 503, { error: "JOB_ADMIN_TOKEN não configurado no ambiente" });
    return false;
  }
  const authHeader = String(req.headers["x-job-token"] ?? "");
  if (authHeader !== JOB_ADMIN_TOKEN) {
    sendJson(res, 401, { error: "Não autorizado" });
    return false;
  }
  return true;
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const { pathname } = requestUrl;

  if (pathname === "/health") {
    sendJson(res, 200, { status: "ok" });
    return;
  }

  if (pathname === "/api/analyze-cnpj") {
    setApiCorsHeaders(res);

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method !== "POST") {
      sendJson(res, 405, { error: "Método não permitido" });
      return;
    }

    try {
      const body = await readJsonBody(req);
      const cnpj = typeof body === "object" && body !== null && "cnpj" in body ? body.cnpj : "";
      const result = await analyzeCnpj(String(cnpj ?? ""));
      const normalizedCnpj = normalizeCnpj(cnpj);
      let payload = result;

      if (normalizedCnpj.length === 14) {
        const searchId = crypto.randomUUID();
        payload = attachSearchMeta(result, { search_id: searchId });

        try {
          const deepRunId =
            payload &&
            typeof payload === "object" &&
            payload.meta &&
            typeof payload.meta === "object" &&
            payload.meta.deep_investigation &&
            typeof payload.meta.deep_investigation === "object"
              ? payload.meta.deep_investigation.run_id ?? null
              : null;

          await createSearchQuery({
            id: searchId,
            cnpj: normalizedCnpj,
            analyzedAt:
              payload && typeof payload === "object" && typeof payload.analyzed_at === "string"
                ? payload.analyzed_at
                : new Date().toISOString(),
            deepRunId,
            result: payload,
          });
        } catch (storeError) {
          console.error("[search-history] failed to persist search query:", storeError);
        }
      }

      sendJson(res, 200, payload);
    } catch (error) {
      if (error instanceof HttpError) {
        sendJson(res, error.statusCode, { error: error.message });
        return;
      }

      console.error("Unhandled API error:", error);
      sendJson(res, 500, { error: "Erro interno ao processar a consulta" });
    }
    return;
  }

  // ── GET /api/searches[?cnpj=&limit=&offset=] ────────────────────────────
  if (pathname === "/api/searches") {
    setApiCorsHeaders(res);

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method !== "GET") {
      sendJson(res, 405, { error: "Método não permitido" });
      return;
    }

    try {
      const cnpj = requestUrl.searchParams.get("cnpj") ?? "";
      const limit = Number.parseInt(requestUrl.searchParams.get("limit") ?? "20", 10);
      const offset = Number.parseInt(requestUrl.searchParams.get("offset") ?? "0", 10);
      const rows = await listSearchQueries({ cnpj, limit, offset });

      const items = rows.map((row) => {
        const result = row.result_json && typeof row.result_json === "object" ? row.result_json : {};
        return {
          search_id: row.id,
          cnpj: row.cnpj,
          requested_at: row.requested_at,
          analyzed_at: row.analyzed_at,
          deep_run_id: row.deep_run_id,
          score: typeof result.score === "number" ? result.score : null,
          classification: typeof result.classification === "string" ? result.classification : null,
          summary: typeof result.summary === "string" ? result.summary : null,
          company_name:
            result.company && typeof result.company === "object" && typeof result.company.razao_social === "string"
              ? result.company.razao_social
              : null,
        };
      });

      sendJson(res, 200, {
        items,
        count: items.length,
      });
    } catch (error) {
      console.error("[search-history] list error:", error);
      sendJson(res, 500, { error: "Erro ao listar histórico de buscas" });
    }
    return;
  }

  // ── GET /api/searches/:search_id ─────────────────────────────────────────
  if (pathname.startsWith("/api/searches/")) {
    setApiCorsHeaders(res);

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method !== "GET") {
      sendJson(res, 405, { error: "Método não permitido" });
      return;
    }

    const match = pathname.match(/^\/api\/searches\/([^/]+)$/);
    if (!match) {
      sendJson(res, 404, { error: "Endpoint de busca não encontrado" });
      return;
    }

    const searchId = decodeURIComponent(match[1]);

    try {
      const row = await getSearchQueryById(searchId);
      if (!row) {
        sendJson(res, 404, { error: "Busca não encontrada" });
        return;
      }

      const baseResult = row.result_json && typeof row.result_json === "object" ? row.result_json : {};
      let computedResult = baseResult;

      const deepRunId =
        row.deep_run_id ??
        (baseResult?.meta &&
        typeof baseResult.meta === "object" &&
        baseResult.meta.deep_investigation &&
        typeof baseResult.meta.deep_investigation === "object"
          ? baseResult.meta.deep_investigation.run_id ?? null
          : null);

      if (deepRunId) {
        let deepSummary = await getInvestigationStatus(String(deepRunId)).catch(() => null);
        if (!deepSummary) {
          const metaDeep =
            baseResult?.meta &&
            typeof baseResult.meta === "object" &&
            baseResult.meta.deep_investigation &&
            typeof baseResult.meta.deep_investigation === "object"
              ? baseResult.meta.deep_investigation
              : null;
          const fallbackStatus = metaDeep?.status ?? null;
          if (fallbackStatus) {
            const judicialFallback =
              (await getInvestigationJudicialSummaryData(String(deepRunId)).catch(() => null)) ??
              (baseResult?.meta &&
              typeof baseResult.meta === "object" &&
              baseResult.meta.judicial_scan &&
              typeof baseResult.meta.judicial_scan === "object"
                ? baseResult.meta.judicial_scan
                : null);
            deepSummary = {
              id: String(deepRunId),
              status: fallbackStatus,
              flags_count: Array.isArray(baseResult?.flags) ? baseResult.flags.length : 0,
              judicial_scan: judicialFallback,
            };
          }
        }
        if (deepSummary) {
          computedResult = mergeDeepInvestigationMeta(computedResult, deepSummary);
          const reconciled = await reconcileResultWithDeepInvestigation(
            computedResult,
            deepSummary,
            String(deepRunId),
          );
          computedResult = reconciled.payload;
          if (reconciled.changed) {
            computedResult = {
              ...computedResult,
              ai_analysis: {
                available: false,
                reason: `Laudo GenAI pendente: recalibração com investigação profunda concluída (run_id: ${deepRunId}).`,
              },
            };
          }
        }

        computedResult = await maybeGenerateFinalAiAnalysis(computedResult, deepSummary ?? { id: deepRunId, status: null });
      }

      let baseSerialized = "";
      let computedSerialized = "";
      try {
        baseSerialized = JSON.stringify(baseResult ?? {});
        computedSerialized = JSON.stringify(computedResult ?? {});
      } catch {
        baseSerialized = "";
        computedSerialized = "";
      }

      if (computedSerialized && baseSerialized !== computedSerialized) {
        await updateSearchQueryResult(searchId, {
          result: computedResult,
          analyzedAt:
            typeof computedResult?.analyzed_at === "string" ? computedResult.analyzed_at : new Date().toISOString(),
          deepRunId: deepRunId ?? null,
        }).catch((error) => {
          console.error("[search-history] update error:", error);
        });
      }

      const payload = attachSearchMeta(computedResult, {
        search_id: row.id,
        search_requested_at: row.requested_at ? new Date(row.requested_at).toISOString() : null,
        search_analyzed_at:
          typeof computedResult?.analyzed_at === "string"
            ? computedResult.analyzed_at
            : row.analyzed_at
              ? new Date(row.analyzed_at).toISOString()
              : null,
      });

      sendJson(res, 200, payload);
    } catch (error) {
      console.error("[search-history] get error:", error);
      sendJson(res, 500, { error: "Erro ao consultar busca salva" });
    }
    return;
  }

  // ── POST /api/jobs/sync-pgfn ─────────────────────────────────────────────
  // Retorna 202 imediatamente; job roda em background sem bloquear HTTP.
  if (pathname === "/api/jobs/sync-pgfn") {
    setApiCorsHeaders(res);

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method !== "POST") {
      sendJson(res, 405, { error: "Método não permitido" });
      return;
    }

    if (!requireJobToken(req, res)) return;

    if (pgfnSyncInFlight) {
      sendJson(res, 409, { error: "Sincronização PGFN já está em andamento" });
      return;
    }

    let onlySourceIds;
    try {
      const body = await readJsonBody(req);
      if (Array.isArray(body?.sources)) onlySourceIds = body.sources;
    } catch {
      // ignore — body is optional
    }

    // Retorna 202 AGORA — não bloqueia até o job terminar
    sendJson(res, 202, {
      message: "Sincronização PGFN iniciada em background",
      sources: onlySourceIds ?? "all",
    });

    // Job corre em background sem await
    pgfnSyncInFlight = runPgfnSyncJob({ onlySourceIds })
      .catch((e) => console.error("[pgfn-sync] job error:", e))
      .finally(() => {
        pgfnSyncInFlight = null;
      });

    return;
  }

  // ── GET /api/jobs/pgfn-status ────────────────────────────────────────────
  if (pathname === "/api/jobs/pgfn-status") {
    setApiCorsHeaders(res);

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method !== "GET") {
      sendJson(res, 405, { error: "Método não permitido" });
      return;
    }

    if (!requireJobToken(req, res)) return;

    try {
      const sources = await getPgfnSourceStatus(PGFN_SOURCE_IDS);
      sendJson(res, 200, {
        in_flight: pgfnSyncInFlight !== null,
        sources,
      });
    } catch (error) {
      console.error("[pgfn-status] error:", error);
      sendJson(res, 500, { error: "Erro ao consultar status do PGFN" });
    }
    return;
  }

  // ── GET /api/investigations/:run_id/judicial/(coverage|processes|summary) ─
  if (pathname.startsWith("/api/investigations/") && pathname.includes("/judicial/")) {
    setApiCorsHeaders(res);

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method !== "GET") {
      sendJson(res, 405, { error: "Método não permitido" });
      return;
    }

    const match = pathname.match(/^\/api\/investigations\/([^/]+)\/judicial\/(coverage|processes|summary)$/);
    if (!match) {
      sendJson(res, 404, { error: "Endpoint judicial da investigação não encontrado" });
      return;
    }

    const runId = decodeURIComponent(match[1]);
    const section = match[2];

    try {
      if (section === "coverage") {
        const payload = await getInvestigationJudicialCoverageData(runId);
        sendJson(res, 200, payload);
        return;
      }

      if (section === "processes") {
        const payload = await getInvestigationJudicialProcessesData(runId);
        sendJson(res, 200, payload);
        return;
      }

      if (section === "summary") {
        const payload = await getInvestigationJudicialSummaryData(runId);
        sendJson(res, 200, payload);
        return;
      }
    } catch (error) {
      console.error("[investigations/judicial] error:", error);
      sendJson(res, 500, { error: "Erro ao consultar dados judiciais da investigação" });
      return;
    }
  }

  // ── GET /api/investigations/:run_id[/graph|/events] ─────────────────────
  if (pathname.startsWith("/api/investigations/")) {
    setApiCorsHeaders(res);

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method !== "GET") {
      sendJson(res, 405, { error: "Método não permitido" });
      return;
    }

    const match = pathname.match(/^\/api\/investigations\/([^/]+)(?:\/(graph|events))?$/);
    if (!match) {
      sendJson(res, 404, { error: "Endpoint de investigação não encontrado" });
      return;
    }

    const runId = decodeURIComponent(match[1]);
    const section = match[2] ?? "status";

    try {
      if (section === "status") {
        const summary = await getInvestigationStatus(runId);
        if (!summary) {
          sendJson(res, 404, { error: "Investigação não encontrada" });
          return;
        }
        sendJson(res, 200, summary);
        return;
      }

      if (section === "graph") {
        const graph = await getInvestigationGraphData(runId);
        if (!graph) {
          sendJson(res, 404, { error: "Grafo da investigação não encontrado" });
          return;
        }
        sendJson(res, 200, graph);
        return;
      }

      if (section === "events") {
        const cursor = Number.parseInt(requestUrl.searchParams.get("cursor") ?? "0", 10);
        const feed = await getInvestigationEventsFeed(runId, Number.isFinite(cursor) ? cursor : 0);
        sendJson(res, 200, feed);
        return;
      }

      sendJson(res, 404, { error: "Seção de investigação não encontrada" });
    } catch (error) {
      console.error("[investigations] error:", error);
      sendJson(res, 500, { error: "Erro ao consultar investigação" });
    }
    return;
  }

  await serveStatic(req, res, pathname);
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Server running on http://0.0.0.0:${port}`);

  // Recupera jobs PGFN presos (status='running' de runs anteriores ao crash)
  recoverStaleJobRuns()
    .then((count) => {
      if (count > 0) {
        console.log(`[startup] Recovered ${count} stale job run(s) → marked as failed`);
      }
    })
    .catch((e) => console.error("[startup] recoverStaleJobRuns error:", e));

  recoverAndResumeInvestigations()
    .then(({ recovered, resumed }) => {
      if (recovered > 0 || resumed > 0) {
        console.log(`[startup] Deep investigations recovered=${recovered} resumed=${resumed}`);
      }
    })
    .catch((e) => console.error("[startup] recoverAndResumeInvestigations error:", e));
});
