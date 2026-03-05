import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeCnpj, HttpError } from "./analyze-cnpj.mjs";
import { analyzePartner, PartnerHttpError } from "./analyze-partner.mjs";
import {
  analyzeEnvironmentalCompliance,
  EnvironmentalHttpError,
} from "./environmental-compliance.mjs";
import {
  ensureEnvironmentalComplianceTables,
  getEnvironmentalAnalysisRun,
  getLatestEnvironmentalAnalysisRunByCnpj,
  isEnvironmentalComplianceStoreEnabled,
  listActionPlanItems,
  listEnvironmentalAnalysisRuns,
  replaceActionPlanItems,
  saveEnvironmentalAnalysisRun,
  upsertActionPlanItems,
} from "./environmental-compliance-store.mjs";
import { captureAreasContaminadasScreenshot } from "./areas-contaminadas-screenshot.mjs";
import { generateIntelligenceReport } from "./ai-synthesis.mjs";
import { runPgfnSyncJob } from "./pgfn-sync.mjs";
import { recoverStaleJobRuns, getPgfnSourceStatus } from "./source-index-store.mjs";
import { PGFN_SOURCE_IDS } from "./source-registry.mjs";
import { fetchWithTimeout } from "./http-utils.mjs";
import {
  createPartnerSearchQuery,
  createSearchQuery,
  ensureScoreHistoryTable,
  getFirstScoreSince,
  getPeerBenchmarkForCnae,
  getPartnerSearchQueryById,
  listScoreHistoryByCnpj,
  getSearchQueryById,
  listPartnerSearchQueries,
  listSearchQueries,
  insertScoreHistory,
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
import { calculateScore, calculateSubscores } from "./risk-scoring.mjs";
import { SOURCE_REGISTRY } from "./source-registry.mjs";
import {
  ensureWatchListTable,
  getWatch,
  isWatchListEnabled,
  listWatched,
  removeWatch,
  upsertWatch,
} from "./watch-list-store.mjs";
import { runMonitorJob } from "./monitor-job.mjs";
import { parseBooleanEnv } from "./common-utils.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const distDir = path.join(projectRoot, "dist");
const port = Number.parseInt(process.env.PORT ?? "3000", 10);
const JOB_ADMIN_TOKEN = (process.env.JOB_ADMIN_TOKEN ?? "").trim();
let pgfnSyncInFlight = null;
const ENV_ANALYSIS_CACHE_MAX = 200;
const ENV_COMPLIANCE_REUSE_WINDOW_DAYS = Math.max(1, Number.parseInt(process.env.ENV_COMPLIANCE_REUSE_WINDOW_DAYS ?? "30", 10) || 30);
const ENV_COMPLIANCE_REUSE_ENABLED = parseBooleanEnv(process.env.ENV_COMPLIANCE_REUSE_ENABLED, true);
const environmentalRunCache = new Map();

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

function normalizeCpf(value) {
  return String(value ?? "")
    .replace(/\D/g, "")
    .slice(0, 11);
}

function normalizeActionPlanStatus(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "em_andamento") return "em_andamento";
  if (normalized === "concluido") return "concluido";
  return "pendente";
}

function normalizeActionPlanPriority(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "alta") return "alta";
  if (normalized === "baixa") return "baixa";
  return "media";
}

function normalizeActionPlanItemsPayload(items) {
  if (!Array.isArray(items)) return [];
  const normalized = [];
  for (const rawItem of items) {
    const id = String(rawItem?.id ?? "").trim();
    const title = String(rawItem?.title ?? "").trim();
    if (!id || !title) continue;
    normalized.push({
      id,
      title: title.slice(0, 400),
      priority: normalizeActionPlanPriority(rawItem?.priority),
      owner: rawItem?.owner ? String(rawItem.owner).slice(0, 120) : null,
      due_date: rawItem?.due_date ? String(rawItem.due_date).slice(0, 10) : null,
      status: normalizeActionPlanStatus(rawItem?.status),
      source_refs: Array.isArray(rawItem?.source_refs) ? rawItem.source_refs.map((entry) => String(entry)) : [],
    });
  }
  return normalized;
}

function cacheEnvironmentalRun(payload) {
  const analysisId = String(payload?.analysis_id ?? "").trim();
  if (!analysisId) return;
  environmentalRunCache.set(analysisId, {
    analysis_id: analysisId,
    cnpj: normalizeCnpj(payload?.cnpj),
    schema_version: payload?.schema_version ?? "br-v1",
    risk_level: payload?.summary?.risk_level ?? null,
    analyzed_at: payload?.analyzed_at ?? new Date().toISOString(),
    created_at: new Date().toISOString(),
    payload_json: payload,
  });

  if (environmentalRunCache.size > ENV_ANALYSIS_CACHE_MAX) {
    const firstKey = environmentalRunCache.keys().next().value;
    if (firstKey) environmentalRunCache.delete(firstKey);
  }
}

function getCachedEnvironmentalRun(analysisId) {
  return environmentalRunCache.get(String(analysisId ?? "").trim()) ?? null;
}

function listCachedEnvironmentalRuns({ cnpj = "", page = 1, limit = 20 } = {}) {
  const normalizedCnpj = normalizeCnpj(cnpj);
  const safePage = Math.max(1, Number.parseInt(String(page), 10) || 1);
  const safeLimit = Math.max(1, Math.min(100, Number.parseInt(String(limit), 10) || 20));
  const entries = [...environmentalRunCache.values()]
    .filter((entry) => (normalizedCnpj.length === 14 ? entry.cnpj === normalizedCnpj : true))
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  const offset = (safePage - 1) * safeLimit;
  const paged = entries.slice(offset, offset + safeLimit);

  return {
    items: paged.map((entry) => ({
      analysis_id: entry.analysis_id,
      cnpj: entry.cnpj,
      schema_version: entry.schema_version,
      risk_level: entry.risk_level,
      razao_social: entry?.payload_json?.company?.razao_social ?? null,
      analyzed_at: entry?.payload_json?.analyzed_at ?? entry.analyzed_at,
      created_at: entry.created_at,
    })),
    page: safePage,
    limit: safeLimit,
    total: entries.length,
  };
}

function toValidDate(value) {
  const date = new Date(String(value ?? ""));
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function computeAgeDays(isoDateLike) {
  const date = toValidDate(isoDateLike);
  if (!date) return null;
  const diffMs = Date.now() - date.getTime();
  if (!Number.isFinite(diffMs) || diffMs < 0) return 0;
  return Math.floor(diffMs / (24 * 60 * 60 * 1000));
}

function formatDateTimePtBr(isoDateLike) {
  const date = toValidDate(isoDateLike);
  if (!date) return null;
  try {
    return new Intl.DateTimeFormat("pt-BR", {
      dateStyle: "short",
      timeStyle: "short",
      timeZone: "America/Sao_Paulo",
    }).format(date);
  } catch {
    return date.toISOString();
  }
}

function buildComplianceCacheMetadata({
  reused = false,
  source = "none",
  analysisId = null,
  previousAnalyzedAt = null,
  reuseWindowDays = ENV_COMPLIANCE_REUSE_WINDOW_DAYS,
  forcedRefresh = false,
}) {
  const ageDays = computeAgeDays(previousAnalyzedAt);
  const formatted = formatDateTimePtBr(previousAnalyzedAt);
  return {
    reused: Boolean(reused),
    source: reused ? source : "none",
    reuse_window_days: Math.max(1, Number.parseInt(String(reuseWindowDays), 10) || ENV_COMPLIANCE_REUSE_WINDOW_DAYS),
    previous_analysis_id: analysisId ? String(analysisId) : null,
    previous_analyzed_at: previousAnalyzedAt ? String(previousAnalyzedAt) : null,
    age_days: ageDays,
    forced_refresh: Boolean(forcedRefresh),
    message: reused
      ? formatted
        ? `Consulta reaproveitada: já existe análise deste CNPJ em ${formatted}.`
        : "Consulta reaproveitada: já existe análise recente deste CNPJ."
      : forcedRefresh
      ? "Reanálise forçada executada; resultado anterior não foi reaproveitado."
      : null,
  };
}

function getLatestCachedEnvironmentalRunByCnpj({ cnpj = "", maxAgeDays = ENV_COMPLIANCE_REUSE_WINDOW_DAYS } = {}) {
  const normalizedCnpj = normalizeCnpj(cnpj);
  if (normalizedCnpj.length !== 14) return null;
  const safeMaxAgeDays = Math.max(1, Number.parseInt(String(maxAgeDays), 10) || ENV_COMPLIANCE_REUSE_WINDOW_DAYS);

  const candidates = [...environmentalRunCache.values()]
    .filter((entry) => entry?.cnpj === normalizedCnpj)
    .sort((a, b) => new Date(b?.created_at ?? 0).getTime() - new Date(a?.created_at ?? 0).getTime());
  const latest = candidates[0] ?? null;
  if (!latest) return null;

  const referenceDate = latest?.payload_json?.analyzed_at || latest?.created_at;
  const ageDays = computeAgeDays(referenceDate);
  if (ageDays == null || ageDays > safeMaxAgeDays) return null;
  return latest;
}

function buildPersistenceInfo({ durable }) {
  const dbConfigured = isEnvironmentalComplianceStoreEnabled();
  return {
    mode: durable ? "database" : "memory_cache",
    durable: Boolean(durable),
    database_configured: Boolean(dbConfigured),
  };
}

function toAsciiText(value) {
  const text = String(value ?? "");
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapePdfText(value) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function wrapText(value, maxLen = 96) {
  const words = toAsciiText(value).split(" ");
  const lines = [];
  let current = "";
  for (const word of words) {
    if (!word) continue;
    const tentative = current ? `${current} ${word}` : word;
    if (tentative.length > maxLen) {
      if (current) lines.push(current);
      current = word;
    } else {
      current = tentative;
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [""];
}

function buildMinimalPdfBuffer(title, lines) {
  const safeTitle = toAsciiText(title || "Relatorio de Compliance Ambiental");
  const normalizedLines = Array.isArray(lines) ? lines.flatMap((line) => wrapText(line, 96)) : [];
  const pageLines = normalizedLines.slice(0, 120);
  const contentLines = [
    "BT",
    "/F1 12 Tf",
    "14 TL",
    "40 800 Td",
    `(${escapePdfText(safeTitle)}) Tj`,
    "T*",
    "T*",
  ];
  for (const line of pageLines) {
    contentLines.push(`(${escapePdfText(toAsciiText(line).slice(0, 180))}) Tj`);
    contentLines.push("T*");
  }
  contentLines.push("ET");
  const contentStream = `${contentLines.join("\n")}\n`;
  const contentLength = Buffer.byteLength(contentStream, "binary");

  const objects = [
    null,
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n",
    "4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
    `5 0 obj\n<< /Length ${contentLength} >>\nstream\n${contentStream}endstream\nendobj\n`,
  ];

  let pdf = "%PDF-1.4\n";
  const offsets = new Array(objects.length).fill(0);
  for (let i = 1; i < objects.length; i += 1) {
    offsets[i] = Buffer.byteLength(pdf, "binary");
    pdf += objects[i];
  }
  const xrefOffset = Buffer.byteLength(pdf, "binary");
  pdf += `xref\n0 ${objects.length}\n`;
  pdf += "0000000000 65535 f \n";
  for (let i = 1; i < objects.length; i += 1) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf, "binary");
}

function buildComplianceExportLines(payload) {
  const lines = [];
  const companyName = payload?.company?.razao_social || "-";
  const cnpj = payload?.cnpj || "-";
  const risk = payload?.summary?.risk_level || "-";
  const alerts = Number(payload?.summary?.total_alerts ?? 0);
  lines.push(`Empresa: ${companyName}`);
  lines.push(`CNPJ: ${cnpj}`);
  lines.push(`Risco agregado: ${String(risk).toUpperCase()} | Alertas: ${alerts}`);
  lines.push(`Analisado em: ${payload?.analyzed_at || "-"}`);
  lines.push("");
  lines.push("DECISAO EXECUTIVA");
  lines.push(String(payload?.ux_v2?.executive?.decision_summary || "Sem resumo executivo."));
  lines.push("");
  lines.push("TOP OBRIGACOES");
  for (const item of Array.isArray(payload?.ux_v2?.executive?.critical_obligations)
    ? payload.ux_v2.executive.critical_obligations.slice(0, 6)
    : []) {
    lines.push(`- ${item}`);
  }
  lines.push("");
  lines.push("LACUNAS DE COBERTURA");
  for (const item of Array.isArray(payload?.ux_v2?.executive?.coverage_gaps)
    ? payload.ux_v2.executive.coverage_gaps.slice(0, 6)
    : []) {
    lines.push(`- ${item}`);
  }
  lines.push("");
  lines.push("PLANO DE ACAO");
  for (const item of Array.isArray(payload?.action_plan?.items) ? payload.action_plan.items.slice(0, 12) : []) {
    lines.push(
      `- [${item?.status || "pendente"}] (${item?.priority || "media"}) ${item?.title || "-"} | resp: ${item?.owner || "-"} | prazo: ${
        item?.due_date || "-"
      }`
    );
  }
  lines.push("");
  lines.push("TRILHA DE EVIDENCIAS");
  for (const item of Array.isArray(payload?.evidence) ? payload.evidence.slice(0, 20) : []) {
    lines.push(`- ${item?.agent || "-"} | ${item?.jurisdiction || "-"} | ${item?.status || "-"} | ${item?.resumo || "-"}`);
  }
  return lines;
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
const FEATURE_PEER_BENCHMARK = parseBooleanEnv(process.env.FEATURE_PEER_BENCHMARK, false);
const PEER_BENCHMARK_MIN_SAMPLE = Number.parseInt(process.env.PEER_BENCHMARK_MIN_SAMPLE ?? "50", 10);
const MONITOR_JOB_ENABLED = parseBooleanEnv(process.env.MONITOR_JOB_ENABLED, true);
const MONITOR_JOB_INTERVAL_MS = Number.parseInt(process.env.MONITOR_JOB_INTERVAL_MS ?? "86400000", 10);
const MONITOR_JOB_INITIAL_DELAY_MS = Number.parseInt(process.env.MONITOR_JOB_INITIAL_DELAY_MS ?? "120000", 10);
let monitorJobInFlight = false;

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeCnae(value) {
  return String(value ?? "")
    .replace(/\D/g, "")
    .slice(0, 7);
}

function trendArrow(delta) {
  if (!Number.isFinite(delta)) return "→";
  if (delta >= 5) return "↑";
  if (delta <= -5) return "↓";
  return "→";
}

function pickClosestScoreAtOrBefore(points, daysAgo) {
  if (!Array.isArray(points) || points.length === 0) return null;
  const targetTs = Date.now() - daysAgo * 24 * 60 * 60 * 1000;
  for (let i = points.length - 1; i >= 0; i -= 1) {
    const point = points[i];
    const ts = new Date(point?.analyzed_at ?? "").getTime();
    if (Number.isFinite(ts) && ts <= targetTs) return point;
  }
  return points[points.length - 1] ?? null;
}

function buildScoreTrend(rows) {
  const points = [...(Array.isArray(rows) ? rows : [])]
    .map((row) => ({
      score: Number(row?.score ?? 0) || 0,
      analyzed_at: row?.analyzed_at ? new Date(row.analyzed_at).toISOString() : null,
    }))
    .filter((row) => row.analyzed_at)
    .sort((a, b) => new Date(a.analyzed_at).getTime() - new Date(b.analyzed_at).getTime());

  if (points.length === 0) {
    return {
      points: [],
      delta_30d: 0,
      delta_90d: 0,
      trend: "→",
    };
  }

  const latest = points[points.length - 1];
  const p30 = pickClosestScoreAtOrBefore(points, 30);
  const p90 = pickClosestScoreAtOrBefore(points, 90);
  const delta30 = latest && p30 ? Number(latest.score ?? 0) - Number(p30.score ?? 0) : 0;
  const delta90 = latest && p90 ? Number(latest.score ?? 0) - Number(p90.score ?? 0) : 0;

  return {
    points,
    delta_30d: delta30,
    delta_90d: delta90,
    trend: trendArrow(delta30),
  };
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

function classifyJudicialTheme(classe, assunto) {
  const text = `${String(classe ?? "")} ${String(assunto ?? "")}`.toLowerCase();
  if (/fal[eê]ncia|insolv[êe]ncia|concordata/.test(text)) return "falencia";
  if (/recupera[çc][aã]o judicial|reestrutura[çc][aã]o/.test(text)) return "recuperacao";
  if (/criminal|penal|improbidade|corrup/.test(text)) return "criminal";
  if (/execu[çc][aã]o fiscal|d[ií]vida ativa|fazenda|tribut[áa]r/i.test(text)) return "fiscal";
  if (/trabalhista|reclama[çc][aã]o|rescis[ãa]o|fgts|trt/.test(text)) return "trabalhista";
  if (/c[ií]vel|contrato|indeniza[çc][aã]o|cobran[çc]a|monit[óo]ria/.test(text)) return "civil";
  return "outro";
}

function buildJudicialAggregateFlags(processItems) {
  if (!Array.isArray(processItems) || processItems.length === 0) return [];

  const counts = {
    criminal: 0,
    fiscal: 0,
    trabalhista: 0,
    civil: 0,
    outro: 0,
    falencia: 0,
    recuperacao: 0,
  };

  for (const item of processItems) {
    const key = classifyJudicialTheme(item?.classe, item?.assunto);
    counts[key] = (counts[key] ?? 0) + 1;
  }

  const flags = [];
  const total = processItems.length;
  const activeThemes = Object.values(counts).filter((value) => value > 0).length;

  if (counts.falencia > 0) {
    flags.push({
      id: "datajud_falencia",
      source_id: "judicial_crawler",
      source: "Crawler Judicial Nacional (Tribunais)",
      severity: "critical",
      title: "Empresa com processo de FALÊNCIA",
      description: `Foram encontrados ${counts.falencia} processo(s) de falência/insolvência na malha judicial consultada.`,
      weight: 50,
      depth: 0,
      verification_status: "objective",
      evidence: [
        { label: "Processos de falência", value: String(counts.falencia) },
        { label: "Total de processos", value: String(total) },
      ],
    });
  }

  if (counts.recuperacao > 0) {
    flags.push({
      id: "datajud_recuperacao_judicial",
      source_id: "judicial_crawler",
      source: "Crawler Judicial Nacional (Tribunais)",
      severity: "critical",
      title: "Empresa em RECUPERAÇÃO JUDICIAL",
      description: `Foram encontrados ${counts.recuperacao} processo(s) de recuperação judicial na malha judicial consultada.`,
      weight: 40,
      depth: 0,
      verification_status: "objective",
      evidence: [
        { label: "Processos de recuperação", value: String(counts.recuperacao) },
        { label: "Total de processos", value: String(total) },
      ],
    });
  }

  if (total >= 20 && activeThemes >= 2) {
    flags.push({
      id: "datajud_carga_judicial_alta",
      source_id: "judicial_crawler",
      source: "Crawler Judicial Nacional (Tribunais)",
      severity: "high",
      title: `Carga judicial elevada: ${total} processos em múltiplas categorias`,
      description: "Volume judicial elevado com múltiplos temas (fiscal/trabalhista/cível/criminal/insolvência).",
      weight: 10,
      depth: 0,
      verification_status: "objective",
      evidence: [
        { label: "Total", value: String(total) },
        { label: "Criminais", value: String(counts.criminal) },
        { label: "Fiscais", value: String(counts.fiscal) },
        { label: "Trabalhistas", value: String(counts.trabalhista) },
        { label: "Falência", value: String(counts.falencia) },
        { label: "Recuperação", value: String(counts.recuperacao) },
      ],
    });
  }

  return flags;
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

function computeCrawlerCoverageSummary(judicial) {
  if (!isObject(judicial)) {
    return {
      eligible: 0,
      success: 0,
      not_found: 0,
      unavailable: 0,
      coverage_percent: 0,
    };
  }

  const eligibleRaw = Number(judicial.eligible ?? Number.NaN);
  const successRaw = Number(judicial.success ?? judicial.matched_tribunals ?? 0);
  const notFoundRaw = Number(judicial.not_found ?? 0);
  const unavailableRaw = Number(judicial.unavailable ?? 0);
  const coverageRaw = Number(judicial.coverage_percent ?? Number.NaN);

  const eligible =
    Number.isFinite(eligibleRaw) && eligibleRaw >= 0
      ? Math.round(eligibleRaw)
      : Math.max(
          0,
          Math.round(
            (Number(judicial.consulted ?? 0) || 0) -
              (Number(judicial.portal_disabled ?? 0) || 0),
          ),
        );
  const success = Math.max(0, Math.round(Number.isFinite(successRaw) ? successRaw : 0));
  const not_found = Math.max(0, Math.round(Number.isFinite(notFoundRaw) ? notFoundRaw : 0));
  const unavailable = Math.max(0, Math.round(Number.isFinite(unavailableRaw) ? unavailableRaw : 0));
  const coverage_percent =
    Number.isFinite(coverageRaw)
      ? Math.max(0, Math.min(100, coverageRaw))
      : eligible > 0
        ? Math.round((((success + not_found) / eligible) * 100) * 10) / 10
        : 0;

  return {
    eligible,
    success,
    not_found,
    unavailable,
    coverage_percent,
  };
}

function upsertSource(sources, sourceId, patch) {
  const normalizedStatus = String(patch?.status ?? "").trim().toLowerCase();
  const normalizedReason = normalizeSourceStatusReason(normalizedStatus, patch?.status_reason);
  const safePatch = {
    ...patch,
    ...(normalizedReason ? { status_reason: normalizedReason } : {}),
  };

  const list = Array.isArray(sources) ? [...sources] : [];
  const index = list.findIndex((item) => item?.id === sourceId);
  if (index >= 0) {
    list[index] = { ...list[index], ...safePatch, id: sourceId };
    return list;
  }

  list.push({
    id: sourceId,
    name: SOURCE_REGISTRY[sourceId]?.name ?? sourceId,
    status: "unavailable",
    ...safePatch,
  });
  return list;
}

function normalizeSourceStatusReason(status, reason) {
  const normalizedStatus = String(status ?? "").trim().toLowerCase();
  const value = String(reason ?? "").trim().toLowerCase();
  if (!value) return "";
  if (normalizedStatus === "not_found") return "not_found";

  const map = {
    not_listed: "not_found",
    no_exact_document_match: "not_found",
    public_query_disabled: "portal_disabled",
    no_tribunal_response: "timeout_or_network",
    upstream_error: "http_error",
    upstream_http_error: "http_error",
    invalid_json_response: "http_error",
    invalid_payload: "http_error",
    invalid_source_result: "http_error",
    missing_source_result: "http_error",
    unhandled_exception: "http_error",
    index_query_failed: "http_error",
    parser_error: "no_automatable_form",
  };

  if (value in map) return map[value];
  if (/^http_\d+$/.test(value)) return "http_error";
  return value;
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
  const eligible = Number(judicial.eligible ?? 0) || 0;
  const success = Number(judicial.success ?? judicial.matched_tribunals ?? 0) || 0;
  const notFound = Number(judicial.not_found ?? 0) || 0;
  return `${runId}:${status}:${flagsCount}:${foundProcesses}:${consulted}:${unavailable}:${eligible}:${success}:${notFound}`;
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

  const judicialProcessItems =
    isObject(judicialProcesses) && Array.isArray(judicialProcesses.items) ? judicialProcesses.items : [];
  const mergedDeepFlags = [
    ...mapDeepFindingsToFlags(graph),
    ...buildJudicialAggregateFlags(judicialProcessItems),
  ];
  const deepFlags = Object.values(
    mergedDeepFlags.reduce((acc, flag) => {
      const key = String(flag?.id ?? "");
      if (!key) return acc;
      if (!acc[key] || Number(acc[key]?.weight ?? 0) < Number(flag?.weight ?? 0)) {
        acc[key] = flag;
      }
      return acc;
    }, {}),
  );
  const scoring = calculateScore(deepFlags);
  const subscores = calculateSubscores(deepFlags);
  const scoreExplanation = {
    top_risks: Array.isArray(scoring.top_risks) ? scoring.top_risks : [],
    mitigators: Array.isArray(scoring.mitigators) ? scoring.mitigators : [],
  };
  const companyName =
    payload.company && typeof payload.company === "object" && typeof payload.company.razao_social === "string"
      ? payload.company.razao_social
      : "empresa";

  let next = {
    ...payload,
    flags: deepFlags,
    score: scoring.score,
    classification: scoring.classification,
    subscores,
    score_explanation: scoreExplanation,
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
    const coverage = computeCrawlerCoverageSummary(judicial);
    meta.judicial_scan = {
      run_id: runId ?? currentJudicial.run_id ?? null,
      status: status ?? currentJudicial.status ?? "running",
      consulted: judicial.consulted ?? currentJudicial.consulted ?? 0,
      supported: judicial.supported ?? currentJudicial.supported ?? 0,
      unavailable: judicial.unavailable ?? currentJudicial.unavailable ?? 0,
      found_processes: judicial.found_processes ?? currentJudicial.found_processes ?? 0,
    };
    meta.crawler_coverage_summary = coverage;
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
    subscores: isObject(payload.subscores) ? payload.subscores : undefined,
    score_explanation: isObject(payload.score_explanation) ? payload.score_explanation : undefined,
    peer_benchmark:
      payload?.meta && isObject(payload.meta) && isObject(payload.meta.peer_benchmark)
        ? payload.meta.peer_benchmark
        : undefined,
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
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, PATCH, DELETE, OPTIONS");
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

const ENV_SOURCE_HEALTH_IDS = [
  "receita_brasilapi",
  "receita_opencnpj",
  "receita_receitaws",
  "cgu_licitacoes_contratos",
  "openai_fte_rag",
  "openai_relatorio_ambiental",
  "ibama_rule_engine",
  "sp_cetesb_licenciamento",
  "sp_consema_municipal",
  "municipal_licenciamento_generico",
  "sp_semil_areas_contaminadas_api",
  "areas_contaminadas_manual_nacional",
];

const ENV_SOURCE_PROBE_CONFIG = {
  receita_brasilapi: {
    url: "https://brasilapi.com.br/api/cnpj/v1/00000000000191",
  },
  receita_opencnpj: {
    url: "https://api.opencnpj.org/v1/cnpj/00000000000191",
  },
  receita_receitaws: {
    url: "https://receitaws.com.br/v1/cnpj/00000000000191",
  },
  cgu_licitacoes_contratos: {
    url: "https://api.portaldatransparencia.gov.br/api-de-dados/contratos/cpf-cnpj?cpfCnpj=00000000000191&pagina=1",
    needsPortalKey: true,
  },
  sp_semil_areas_contaminadas_api: {
    url: "https://mapas.semil.sp.gov.br/server/rest/services/SIGAM/Empreendimento_Contaminacao_SGP/MapServer/1/query?where=1%3D0&outFields=OBJECTID&f=json",
  },
};

function buildSourceHealthSummary(items) {
  return {
    total: items.length,
    up: items.filter((item) => item.status === "up").length,
    degraded: items.filter((item) => item.status === "degraded").length,
    down: items.filter((item) => item.status === "down").length,
    disabled: items.filter((item) => item.status === "disabled").length,
    manual_required: items.filter((item) => item.status === "manual_required").length,
  };
}

async function probeEnvironmentalSourceHealth(sourceId) {
  const source = SOURCE_REGISTRY[sourceId];
  const defaultResult = {
    source_id: sourceId,
    name: source?.name ?? sourceId,
    enabled: source ? parseBooleanEnv(process.env[source.featureFlag], true) : true,
    status: "manual_required",
    status_reason: "manual_source",
    latency_ms: 0,
  };

  if (!source) {
    return {
      ...defaultResult,
      status: "degraded",
      status_reason: "source_not_registered",
    };
  }

  if (!defaultResult.enabled) {
    return {
      ...defaultResult,
      status: "disabled",
      status_reason: "feature_disabled",
    };
  }

  const probe = ENV_SOURCE_PROBE_CONFIG[sourceId];
  if (!probe) {
    if (sourceId === "openai_fte_rag" || sourceId === "openai_relatorio_ambiental") {
      const hasKey = Boolean(String(process.env.OPENAI_API_KEY ?? "").trim());
      return {
        ...defaultResult,
        status: hasKey ? "up" : "degraded",
        status_reason: hasKey ? "api_key_present" : "missing_api_key",
      };
    }

    if (sourceId === "municipal_licenciamento_generico" || sourceId === "areas_contaminadas_manual_nacional") {
      return {
        ...defaultResult,
        status: "manual_required",
        status_reason: "manual_assisted_flow",
      };
    }

    return {
      ...defaultResult,
      status: "up",
      status_reason: "rule_engine_ready",
    };
  }

  if (probe.needsPortalKey && !String(process.env.PORTAL_TRANSPARENCIA_API_KEY ?? "").trim()) {
    return {
      ...defaultResult,
      status: "degraded",
      status_reason: "missing_api_key",
      checked_via: "credential_check",
    };
  }

  const startedAt = Date.now();
  const headers = { accept: "application/json" };
  if (probe.needsPortalKey) {
    headers["chave-api-dados"] = String(process.env.PORTAL_TRANSPARENCIA_API_KEY ?? "").trim();
  }

  const response = await fetchWithTimeout(probe.url, 4500, {
    method: "GET",
    headers,
  });
  const latencyMs = Date.now() - startedAt;

  if (!response) {
    return {
      ...defaultResult,
      status: "down",
      status_reason: "timeout_or_network",
      latency_ms: latencyMs,
      checked_via: "http_probe",
    };
  }

  const acceptable =
    response.ok ||
    response.status === 400 ||
    response.status === 401 ||
    response.status === 403 ||
    response.status === 404 ||
    response.status === 429;

  return {
    ...defaultResult,
    status: acceptable ? "up" : "degraded",
    status_reason: acceptable ? "http_reachable" : `http_${response.status}`,
    latency_ms: latencyMs,
    checked_via: "http_probe",
    http_status: response.status,
  };
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const { pathname } = requestUrl;

  if (pathname === "/health") {
    sendJson(res, 200, { status: "ok" });
    return;
  }

  if (pathname === "/api/sources/health") {
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
      const checks = await Promise.all(ENV_SOURCE_HEALTH_IDS.map((sourceId) => probeEnvironmentalSourceHealth(sourceId)));
      sendJson(res, 200, {
        schema_version: "sources-health-v1",
        analyzed_at: new Date().toISOString(),
        summary: buildSourceHealthSummary(checks),
        sources: checks,
      });
      return;
    } catch (error) {
      console.error("[api/sources/health] unexpected error", error);
      sendJson(res, 500, { error: "Erro interno ao consultar saúde das fontes" });
      return;
    }
  }

  if (pathname === "/api/environmental-compliance") {
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
      const normalizedCnpj = normalizeCnpj(cnpj);
      const forceRefreshQuery = String(requestUrl.searchParams.get("force_refresh") ?? "").trim().toLowerCase();
      const forceRefreshBody =
        typeof body === "object" &&
        body !== null &&
        "force_refresh" in body &&
        (body.force_refresh === true || String(body.force_refresh).trim().toLowerCase() === "true" || String(body.force_refresh).trim() === "1");
      const forceRefresh = forceRefreshBody || forceRefreshQuery === "true" || forceRefreshQuery === "1";

      if (ENV_COMPLIANCE_REUSE_ENABLED && !forceRefresh && normalizedCnpj.length === 14) {
        const dbRecentRun = await getLatestEnvironmentalAnalysisRunByCnpj({
          cnpj: normalizedCnpj,
          maxAgeDays: ENV_COMPLIANCE_REUSE_WINDOW_DAYS,
        });
        if (dbRecentRun?.payload_json && typeof dbRecentRun.payload_json === "object") {
          const storedPayload = dbRecentRun.payload_json;
          const storedAnalysisId = String(dbRecentRun.analysis_id ?? "").trim();
          const actionPlanItems = await listActionPlanItems(storedAnalysisId);
          const normalizedActionPlanItems =
            actionPlanItems.length > 0 ? actionPlanItems : normalizeActionPlanItemsPayload(storedPayload?.action_plan?.items ?? []);
          const previousAnalyzedAt = storedPayload?.analyzed_at ?? dbRecentRun.created_at ?? null;
          const reusedPayload = {
            ...storedPayload,
            analysis_id: storedAnalysisId || storedPayload?.analysis_id || null,
            action_plan: {
              items: normalizedActionPlanItems,
            },
            persistence: buildPersistenceInfo({ durable: true }),
            cache: buildComplianceCacheMetadata({
              reused: true,
              source: "database",
              analysisId: storedAnalysisId || storedPayload?.analysis_id || null,
              previousAnalyzedAt,
              reuseWindowDays: ENV_COMPLIANCE_REUSE_WINDOW_DAYS,
            }),
          };
          try {
            await saveEnvironmentalAnalysisRun({
              analysisId: storedAnalysisId,
              cnpj: normalizedCnpj,
              schemaVersion: reusedPayload?.schema_version ?? "br-v1",
              riskLevel: reusedPayload?.summary?.risk_level ?? null,
              payload: reusedPayload,
            });
          } catch (storeError) {
            console.error("[api/environmental-compliance] failed to update reused payload metadata:", storeError);
          }
          cacheEnvironmentalRun(reusedPayload);
          sendJson(res, 200, reusedPayload);
          return;
        }

        const memoryRecentRun = getLatestCachedEnvironmentalRunByCnpj({
          cnpj: normalizedCnpj,
          maxAgeDays: ENV_COMPLIANCE_REUSE_WINDOW_DAYS,
        });
        if (memoryRecentRun?.payload_json && typeof memoryRecentRun.payload_json === "object") {
          const storedPayload = memoryRecentRun.payload_json;
          const storedAnalysisId = String(memoryRecentRun.analysis_id ?? "").trim();
          const normalizedActionPlanItems = normalizeActionPlanItemsPayload(storedPayload?.action_plan?.items ?? []);
          const previousAnalyzedAt = storedPayload?.analyzed_at ?? memoryRecentRun.created_at ?? null;
          const reusedPayload = {
            ...storedPayload,
            analysis_id: storedAnalysisId || storedPayload?.analysis_id || null,
            action_plan: {
              items: normalizedActionPlanItems,
            },
            persistence: buildPersistenceInfo({ durable: false }),
            cache: buildComplianceCacheMetadata({
              reused: true,
              source: "memory_cache",
              analysisId: storedAnalysisId || storedPayload?.analysis_id || null,
              previousAnalyzedAt,
              reuseWindowDays: ENV_COMPLIANCE_REUSE_WINDOW_DAYS,
            }),
          };
          cacheEnvironmentalRun(reusedPayload);
          sendJson(res, 200, reusedPayload);
          return;
        }
      }

      const payload = await analyzeEnvironmentalCompliance(String(cnpj ?? ""));
      const analysisId = crypto.randomUUID();
      const normalizedActionPlanItems = normalizeActionPlanItemsPayload(payload?.action_plan?.items ?? []);
      const normalizedPayload = {
        ...payload,
        analysis_id: analysisId,
        action_plan: {
          items: normalizedActionPlanItems,
        },
        persistence: buildPersistenceInfo({ durable: false }),
        cache: buildComplianceCacheMetadata({
          reused: false,
          source: "none",
          reuseWindowDays: ENV_COMPLIANCE_REUSE_WINDOW_DAYS,
          forcedRefresh: forceRefresh,
        }),
      };
      cacheEnvironmentalRun(normalizedPayload);

      try {
        const persisted = await saveEnvironmentalAnalysisRun({
          analysisId,
          cnpj: normalizedPayload?.cnpj,
          schemaVersion: normalizedPayload?.schema_version ?? "br-v1",
          riskLevel: normalizedPayload?.summary?.risk_level ?? null,
          payload: normalizedPayload,
        });
        if (persisted) {
          normalizedPayload.persistence = buildPersistenceInfo({ durable: true });
        }

        if (normalizedActionPlanItems.length > 0) {
          const savedActionPlanItems = await replaceActionPlanItems(analysisId, normalizedActionPlanItems);
          normalizedPayload.action_plan.items =
            savedActionPlanItems.length > 0 ? savedActionPlanItems : normalizedActionPlanItems;
          const persistedAfterActionPlan = await saveEnvironmentalAnalysisRun({
            analysisId,
            cnpj: normalizedPayload?.cnpj,
            schemaVersion: normalizedPayload?.schema_version ?? "br-v1",
            riskLevel: normalizedPayload?.summary?.risk_level ?? null,
            payload: normalizedPayload,
          });
          if (persistedAfterActionPlan) {
            normalizedPayload.persistence = buildPersistenceInfo({ durable: true });
          }
        }
      } catch (storeError) {
        console.error("[api/environmental-compliance] failed to persist run:", storeError);
      }

      sendJson(res, 200, normalizedPayload);
      return;
    } catch (error) {
      if (error instanceof EnvironmentalHttpError) {
        sendJson(res, error.statusCode, { error: error.message });
        return;
      }
      console.error("[api/environmental-compliance] unexpected error", error);
      sendJson(res, 500, { error: "Erro interno ao processar compliance ambiental" });
      return;
    }
  }

  if (pathname === "/api/environmental-compliance/history") {
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
      const page = Number.parseInt(requestUrl.searchParams.get("page") ?? "1", 10);
      const limit = Number.parseInt(requestUrl.searchParams.get("limit") ?? "20", 10);
      const dbHistory = await listEnvironmentalAnalysisRuns({ cnpj, page, limit });
      const history = dbHistory.total > 0 ? dbHistory : listCachedEnvironmentalRuns({ cnpj, page, limit });
      sendJson(res, 200, {
        schema_version: "br-history-v1",
        persistence: buildPersistenceInfo({ durable: dbHistory.total > 0 }),
        ...history,
      });
      return;
    } catch (error) {
      console.error("[api/environmental-compliance/history] unexpected error", error);
      sendJson(res, 500, { error: "Erro interno ao consultar histórico ambiental" });
      return;
    }
  }

  const environmentalActionPlanMatch = pathname.match(/^\/api\/environmental-compliance\/([^/]+)\/action-plan$/);
  if (environmentalActionPlanMatch) {
    setApiCorsHeaders(res);

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method !== "PATCH") {
      sendJson(res, 405, { error: "Método não permitido" });
      return;
    }

    const analysisId = decodeURIComponent(environmentalActionPlanMatch[1]);
    try {
      const body = await readJsonBody(req);
      const items = normalizeActionPlanItemsPayload(body?.items);
      if (items.length === 0) {
        sendJson(res, 400, { error: "Informe action_plan.items com pelo menos 1 item válido." });
        return;
      }

      const dbRun = await getEnvironmentalAnalysisRun(analysisId);
      const currentRun = dbRun ?? getCachedEnvironmentalRun(analysisId);
      if (!currentRun) {
        sendJson(res, 404, { error: "Análise ambiental não encontrada." });
        return;
      }

      const currentPayload =
        currentRun.payload_json && typeof currentRun.payload_json === "object" ? currentRun.payload_json : {};
      const currentItems = normalizeActionPlanItemsPayload(currentPayload?.action_plan?.items);
      const mergedMap = new Map(currentItems.map((item) => [item.id, item]));
      for (const item of items) {
        mergedMap.set(item.id, { ...mergedMap.get(item.id), ...item });
      }
      const mergedItems = [...mergedMap.values()];
      const updatedItems = await upsertActionPlanItems(analysisId, items);
      const nextItems = updatedItems.length > 0 ? updatedItems : mergedItems;
      const nextPayload = {
        ...currentPayload,
        analysis_id: analysisId,
        action_plan: {
          items: nextItems,
        },
        persistence: buildPersistenceInfo({ durable: Boolean(dbRun) }),
      };
      cacheEnvironmentalRun(nextPayload);

      await saveEnvironmentalAnalysisRun({
        analysisId,
        cnpj: currentRun.cnpj,
        schemaVersion: currentRun.schema_version ?? "br-v1",
        riskLevel: currentRun.risk_level ?? nextPayload?.summary?.risk_level ?? null,
        payload: nextPayload,
      });

      sendJson(res, 200, {
        analysis_id: analysisId,
        persistence: buildPersistenceInfo({ durable: Boolean(dbRun) }),
        action_plan: {
          items: nextItems,
        },
      });
      return;
    } catch (error) {
      console.error("[api/environmental-compliance/:analysis_id/action-plan] unexpected error", error);
      sendJson(res, 500, { error: "Erro interno ao atualizar plano de ação" });
      return;
    }
  }

  const environmentalExportPdfMatch = pathname.match(/^\/api\/environmental-compliance\/([^/]+)\/export\.pdf$/);
  if (environmentalExportPdfMatch) {
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

    const analysisId = decodeURIComponent(environmentalExportPdfMatch[1]);
    try {
      const dbRow = await getEnvironmentalAnalysisRun(analysisId);
      const row = dbRow ?? getCachedEnvironmentalRun(analysisId);
      if (!row) {
        sendJson(res, 404, { error: "Análise ambiental não encontrada." });
        return;
      }

      const payload = row.payload_json && typeof row.payload_json === "object" ? row.payload_json : {};
      const actionPlanItems = await listActionPlanItems(analysisId);
      const exportPayload = {
        ...payload,
        analysis_id: analysisId,
        persistence: buildPersistenceInfo({ durable: Boolean(dbRow) }),
        action_plan: {
          items: actionPlanItems.length > 0 ? actionPlanItems : normalizeActionPlanItemsPayload(payload?.action_plan?.items),
        },
      };
      const lines = buildComplianceExportLines(exportPayload);
      const pdfBuffer = buildMinimalPdfBuffer(
        `Compliance Ambiental - ${exportPayload?.company?.razao_social || exportPayload?.cnpj || analysisId}`,
        lines
      );
      const fileName = `compliance-ambiental-${String(exportPayload?.cnpj || analysisId).replace(/\W+/g, "")}.pdf`;
      res.writeHead(200, {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Content-Length": String(pdfBuffer.byteLength),
      });
      res.end(pdfBuffer);
      return;
    } catch (error) {
      console.error("[api/environmental-compliance/:analysis_id/export.pdf] unexpected error", error);
      sendJson(res, 500, { error: "Erro interno ao exportar PDF" });
      return;
    }
  }

  const environmentalGetMatch = pathname.match(/^\/api\/environmental-compliance\/([^/]+)$/);
  if (environmentalGetMatch) {
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

    const analysisId = decodeURIComponent(environmentalGetMatch[1]);
    try {
      const dbRow = await getEnvironmentalAnalysisRun(analysisId);
      const row = dbRow ?? getCachedEnvironmentalRun(analysisId);
      if (!row) {
        sendJson(res, 404, { error: "Análise ambiental não encontrada." });
        return;
      }

      const payload = row.payload_json && typeof row.payload_json === "object" ? row.payload_json : {};
      const actionPlanItems = await listActionPlanItems(analysisId);
      const normalizedItems =
        actionPlanItems.length > 0 ? actionPlanItems : normalizeActionPlanItemsPayload(payload?.action_plan?.items);
      const normalizedPayload = {
        ...payload,
        analysis_id: analysisId,
        persistence: buildPersistenceInfo({ durable: Boolean(dbRow) }),
        action_plan: {
          items: normalizedItems,
        },
      };
      sendJson(res, 200, normalizedPayload);
      return;
    } catch (error) {
      console.error("[api/environmental-compliance/:analysis_id] unexpected error", error);
      sendJson(res, 500, { error: "Erro interno ao consultar análise ambiental" });
      return;
    }
  }

  if (pathname === "/api/areas-contaminadas/screenshot") {
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
      const mapUrl = typeof body?.map_url === "string" ? body.map_url : "";
      const razaoSocial = typeof body?.razao_social === "string" ? body.razao_social : "";
      const cnpj = typeof body?.cnpj === "string" ? body.cnpj : "";
      const includeBase64 = typeof body?.include_base64 === "boolean" ? body.include_base64 : true;

      if (!mapUrl && !cnpj) {
        sendJson(res, 400, {
          error: "Informe map_url ou cnpj para capturar screenshot de areas contaminadas.",
        });
        return;
      }

      let resolvedMapUrl = mapUrl;
      let resolvedRazaoSocial = razaoSocial;
      let resolvedCnpj = cnpj;

      if (!resolvedMapUrl && cnpj) {
        const analysis = await analyzeEnvironmentalCompliance(cnpj);
        resolvedMapUrl = String(analysis?.areas_contaminadas?.official_map_open_url ?? "");
        resolvedRazaoSocial = resolvedRazaoSocial || String(analysis?.company?.razao_social ?? "");
        resolvedCnpj = resolvedCnpj || String(analysis?.cnpj ?? "");
      }

      const capture = await captureAreasContaminadasScreenshot({
        mapUrl: resolvedMapUrl,
        razaoSocial: resolvedRazaoSocial,
        cnpj: resolvedCnpj,
        includeBase64,
      });

      sendJson(res, 200, {
        schema_version: "areas-screenshot-v1",
        capture,
      });
      return;
    } catch (error) {
      console.error("[api/areas-contaminadas/screenshot] unexpected error", error);
      sendJson(res, 500, { error: "Erro interno ao capturar screenshot de areas contaminadas" });
      return;
    }
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

        // Timeline de risco (1º passo): compara score atual vs score mais antigo dos últimos 90 dias.
        try {
          const baseline90d = await getFirstScoreSince(normalizedCnpj, 90);
          const currentScore = Number(payload?.score ?? 0);
          const baselineScore = Number(baseline90d?.score ?? NaN);
          const hasValidBaseline =
            baseline90d &&
            Number.isFinite(baselineScore) &&
            baseline90d.analyzed_at &&
            Number.isFinite(new Date(baseline90d.analyzed_at).getTime());

          if (hasValidBaseline) {
            const delta90 = currentScore - baselineScore;
            const hasAgravamentoFlag = Array.isArray(payload?.flags)
              ? payload.flags.some((flag) => flag?.id === "agravamento_recente")
              : false;

            if (delta90 >= 15 && !hasAgravamentoFlag) {
              const agravamentoFlag = {
                id: "agravamento_recente",
                source_id: "score_timeline",
                source: "Timeline de risco (histórico interno)",
                severity: "high",
                title: "Agravamento recente do risco",
                description:
                  `Score subiu ${delta90} ponto(s) em até 90 dias, comparando ${baselineScore} ` +
                  `(${new Date(baseline90d.analyzed_at).toLocaleDateString("pt-BR")}) com ${currentScore} (atual).`,
                weight: 15,
                verification_status: "objective",
                evidence: [
                  { label: "Score há 90 dias", value: String(baselineScore) },
                  { label: "Data base", value: new Date(baseline90d.analyzed_at).toISOString().slice(0, 10) },
                  { label: "Score atual", value: String(currentScore) },
                  { label: "Variação", value: `+${delta90}` },
                ],
              };

              const nextFlags = [...(Array.isArray(payload?.flags) ? payload.flags : []), agravamentoFlag];
              const rescoring = calculateScore(nextFlags);
              const resubscores = calculateSubscores(nextFlags);
              payload = {
                ...payload,
                flags: nextFlags,
                score: rescoring.score,
                classification: rescoring.classification,
                subscores: resubscores,
                score_explanation: {
                  top_risks: rescoring.top_risks ?? [],
                  mitigators: rescoring.mitigators ?? [],
                },
                summary: buildSummaryText(
                  rescoring.classification,
                  nextFlags,
                  payload?.company?.razao_social ?? "empresa",
                ),
                sources: upsertSource(payload?.sources, "score_timeline", {
                  name: "Timeline de Risco (Histórico Interno)",
                  status: "success",
                  status_reason: "score_increase_detected",
                  message: `Score agravou +${delta90} ponto(s) nos últimos 90 dias.`,
                  evidence_count: 1,
                }),
              };
            }
          }
        } catch (timelineError) {
          console.error("[score-timeline] baseline check failed:", timelineError);
        }

        // Histórico de score + tendência + benchmark por CNAE (feature-flag).
        try {
          await insertScoreHistory({
            cnpj: normalizedCnpj,
            cnae: payload?.company?.cnae_fiscal,
            score: payload?.score,
            classification: payload?.classification,
            subscores: payload?.subscores,
            analyzedAt: payload?.analyzed_at ?? new Date().toISOString(),
            searchId,
          });

          const trendRows = await listScoreHistoryByCnpj(normalizedCnpj, { limit: 6 });
          const trend = buildScoreTrend(trendRows);
          const nextMeta = isObject(payload?.meta) ? { ...payload.meta } : {};
          nextMeta.score_trend = trend;

          if (FEATURE_PEER_BENCHMARK) {
            const benchmark = await getPeerBenchmarkForCnae(
              normalizeCnae(payload?.company?.cnae_fiscal),
              payload?.score,
              { minSample: PEER_BENCHMARK_MIN_SAMPLE },
            );
            if (benchmark) {
              nextMeta.peer_benchmark = benchmark;
            }
          }

          payload = { ...payload, meta: nextMeta };
        } catch (scoreHistoryError) {
          console.error("[score-history] failed to persist/read score history:", scoreHistoryError);
        }

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

  if (pathname === "/api/analyze-partner") {
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
      const cpf = typeof body === "object" && body !== null && "cpf" in body ? body.cpf : "";
      const nome = typeof body === "object" && body !== null && "nome" in body ? body.nome : "";

      const result = await analyzePartner({
        cnpj: String(cnpj ?? ""),
        cpf: String(cpf ?? ""),
        nome: String(nome ?? ""),
      });

      const normalizedCnpj = normalizeCnpj(cnpj);
      const normalizedCpf = normalizeCpf(cpf);
      let payload = result;

      if (normalizedCnpj.length === 14 && normalizedCpf.length === 11) {
        const searchId = crypto.randomUUID();
        payload = attachSearchMeta(result, { partner_search_id: searchId });

        try {
          await createPartnerSearchQuery({
            id: searchId,
            cnpj: normalizedCnpj,
            cpf: normalizedCpf,
            nome:
              payload &&
              typeof payload === "object" &&
              payload.person &&
              typeof payload.person === "object" &&
              typeof payload.person.nome === "string"
                ? payload.person.nome
                : String(nome ?? "").trim(),
            analyzedAt:
              payload && typeof payload === "object" && typeof payload.analyzed_at === "string"
                ? payload.analyzed_at
                : new Date().toISOString(),
            result: payload,
          });
        } catch (storeError) {
          console.error("[partner-search-history] failed to persist partner search query:", storeError);
        }
      }

      sendJson(res, 200, payload);
    } catch (error) {
      if (error instanceof PartnerHttpError) {
        sendJson(res, error.statusCode, { error: error.message });
        return;
      }

      console.error("[analyze-partner] unhandled API error:", error);
      sendJson(res, 500, { error: "Erro interno ao processar a consulta de sócio" });
    }
    return;
  }

  // ── GET /api/partner-searches[?cnpj=&cpf=&limit=&offset=] ───────────────
  if (pathname === "/api/partner-searches") {
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
      const cpf = requestUrl.searchParams.get("cpf") ?? "";
      const limit = Number.parseInt(requestUrl.searchParams.get("limit") ?? "20", 10);
      const offset = Number.parseInt(requestUrl.searchParams.get("offset") ?? "0", 10);
      const rows = await listPartnerSearchQueries({ cnpj, cpf, limit, offset });

      const items = rows.map((row) => {
        const result = row.result_json && typeof row.result_json === "object" ? row.result_json : {};
        return {
          partner_search_id: row.id,
          cnpj: row.cnpj,
          cpf: row.cpf,
          nome: row.nome,
          requested_at: row.requested_at,
          analyzed_at: row.analyzed_at,
          score: typeof result.score === "number" ? result.score : null,
          classification: typeof result.classification === "string" ? result.classification : null,
          summary: typeof result.summary === "string" ? result.summary : null,
          company_name:
            result.company_context &&
            typeof result.company_context === "object" &&
            typeof result.company_context.razao_social === "string"
              ? result.company_context.razao_social
              : null,
        };
      });

      sendJson(res, 200, {
        items,
        count: items.length,
      });
    } catch (error) {
      console.error("[partner-search-history] list error:", error);
      sendJson(res, 500, { error: "Erro ao listar histórico de buscas de sócio" });
    }
    return;
  }

  // ── GET /api/partner-searches/:partner_search_id ─────────────────────────
  if (pathname.startsWith("/api/partner-searches/")) {
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

    const match = pathname.match(/^\/api\/partner-searches\/([^/]+)$/);
    if (!match) {
      sendJson(res, 404, { error: "Endpoint de busca de sócio não encontrado" });
      return;
    }

    const searchId = decodeURIComponent(match[1]);
    try {
      const row = await getPartnerSearchQueryById(searchId);
      if (!row) {
        sendJson(res, 404, { error: "Busca de sócio não encontrada" });
        return;
      }

      const baseResult = row.result_json && typeof row.result_json === "object" ? row.result_json : {};
      const payload = attachSearchMeta(baseResult, {
        partner_search_id: row.id,
        search_requested_at: row.requested_at ? new Date(row.requested_at).toISOString() : null,
        search_analyzed_at:
          row.analyzed_at && Number.isFinite(new Date(row.analyzed_at).getTime())
            ? new Date(row.analyzed_at).toISOString()
            : null,
      });
      sendJson(res, 200, payload);
    } catch (error) {
      console.error("[partner-search-history] get error:", error);
      sendJson(res, 500, { error: "Erro ao consultar busca de sócio salva" });
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

      }

      // Reanexa score trend/benchmark mais recente para o CNPJ da busca salva.
      if (row.cnpj) {
        try {
          const trendRows = await listScoreHistoryByCnpj(row.cnpj, { limit: 6 });
          const trend = buildScoreTrend(trendRows);
          const nextMeta = isObject(computedResult?.meta) ? { ...computedResult.meta } : {};
          nextMeta.score_trend = trend;

          if (FEATURE_PEER_BENCHMARK) {
            const benchmark = await getPeerBenchmarkForCnae(
              normalizeCnae(computedResult?.company?.cnae_fiscal),
              computedResult?.score,
              { minSample: PEER_BENCHMARK_MIN_SAMPLE },
            );
            if (benchmark) nextMeta.peer_benchmark = benchmark;
          }

          computedResult = { ...computedResult, meta: nextMeta };
        } catch (scoreMetaError) {
          console.error("[score-history] failed to refresh trend/benchmark:", scoreMetaError);
        }
      }

      if (deepRunId) {
        const deepSummaryForAi = await getInvestigationStatus(String(deepRunId)).catch(() => null);
        computedResult = await maybeGenerateFinalAiAnalysis(
          computedResult,
          deepSummaryForAi ?? { id: deepRunId, status: null },
        );
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

  // ── GET /api/watch-list ──────────────────────────────────────────────────
  if (pathname === "/api/watch-list" && req.method === "GET") {
    setApiCorsHeaders(res);
    try {
      if (!isWatchListEnabled()) {
        sendJson(res, 503, { error: "Watch list requer DATABASE_URL configurado" });
        return;
      }
      const items = await listWatched();
      sendJson(res, 200, { items, count: items.length });
    } catch (error) {
      console.error("[watch-list] list error:", error);
      sendJson(res, 500, { error: "Erro ao listar watch list" });
    }
    return;
  }

  // ── POST /api/watch-list ─────────────────────────────────────────────────
  if (pathname === "/api/watch-list" && req.method === "POST") {
    setApiCorsHeaders(res);
    try {
      if (!isWatchListEnabled()) {
        sendJson(res, 503, { error: "Watch list requer DATABASE_URL configurado" });
        return;
      }
      const body = await readJsonBody(req);
      const cnpj = normalizeCnpj(body?.cnpj ?? "");
      if (cnpj.length !== 14) {
        sendJson(res, 400, { error: "CNPJ inválido ou não informado" });
        return;
      }
      const item = await upsertWatch({
        cnpj,
        label: typeof body?.label === "string" ? body.label.trim() : undefined,
        webhook_url: typeof body?.webhook_url === "string" ? body.webhook_url.trim() : undefined,
        score_threshold: body?.score_threshold != null ? Number(body.score_threshold) : 10,
      });
      sendJson(res, 200, { ok: true, item });
    } catch (error) {
      console.error("[watch-list] upsert error:", error);
      sendJson(res, 500, { error: "Erro ao adicionar CNPJ à watch list" });
    }
    return;
  }

  // ── DELETE /api/watch-list/:cnpj ─────────────────────────────────────────
  if (pathname.startsWith("/api/watch-list/") && req.method === "DELETE") {
    setApiCorsHeaders(res);
    try {
      if (!isWatchListEnabled()) {
        sendJson(res, 503, { error: "Watch list requer DATABASE_URL configurado" });
        return;
      }
      const match = pathname.match(/^\/api\/watch-list\/([^/]+)$/);
      if (!match) {
        sendJson(res, 404, { error: "Endpoint não encontrado" });
        return;
      }
      const cnpj = normalizeCnpj(decodeURIComponent(match[1]));
      if (cnpj.length !== 14) {
        sendJson(res, 400, { error: "CNPJ inválido" });
        return;
      }
      const removed = await removeWatch(cnpj);
      sendJson(res, removed ? 200 : 404, {
        ok: removed,
        message: removed ? "CNPJ removido da watch list" : "CNPJ não encontrado na watch list",
      });
    } catch (error) {
      console.error("[watch-list] remove error:", error);
      sendJson(res, 500, { error: "Erro ao remover CNPJ da watch list" });
    }
    return;
  }

  // ── OPTIONS /api/watch-list[/*] ──────────────────────────────────────────
  if (pathname === "/api/watch-list" || pathname.startsWith("/api/watch-list/")) {
    if (req.method === "OPTIONS") {
      setApiCorsHeaders(res);
      res.writeHead(204);
      res.end();
      return;
    }
  }

  // ── GET /api/watch-list/:cnpj ─────────────────────────────────────────────
  if (pathname.startsWith("/api/watch-list/") && req.method === "GET") {
    setApiCorsHeaders(res);
    try {
      if (!isWatchListEnabled()) {
        sendJson(res, 503, { error: "Watch list requer DATABASE_URL configurado" });
        return;
      }
      const match = pathname.match(/^\/api\/watch-list\/([^/]+)$/);
      if (!match) {
        sendJson(res, 404, { error: "Endpoint não encontrado" });
        return;
      }
      const cnpj = normalizeCnpj(decodeURIComponent(match[1]));
      const item = await getWatch(cnpj);
      if (!item) {
        sendJson(res, 404, { error: "CNPJ não encontrado na watch list" });
        return;
      }
      sendJson(res, 200, item);
    } catch (error) {
      console.error("[watch-list] get error:", error);
      sendJson(res, 500, { error: "Erro ao consultar watch list" });
    }
    return;
  }

  // ── POST /api/jobs/monitor-run ───────────────────────────────────────────
  if (pathname === "/api/jobs/monitor-run") {
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

    // Retorna 202 imediatamente — job corre em background
    sendJson(res, 202, { message: "Monitor job iniciado em background" });

    runMonitorJob()
      .then(({ processed, triggered, errors }) => {
        console.log(`[monitor-run] done — processed=${processed} triggered=${triggered} errors=${errors}`);
      })
      .catch((e) => console.error("[monitor-run] job error:", e));

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

  ensureWatchListTable()
    .then((ok) => {
      if (ok) console.log("[startup] Watch list table ensured");
    })
    .catch((e) => console.error("[startup] ensureWatchListTable error:", e));

  ensureScoreHistoryTable()
    .then((ok) => {
      if (ok) console.log("[startup] Score history table ensured");
    })
    .catch((e) => console.error("[startup] ensureScoreHistoryTable error:", e));

  ensureEnvironmentalComplianceTables()
    .then((ok) => {
      if (ok) console.log("[startup] Environmental compliance tables ensured");
    })
    .catch((e) => console.error("[startup] ensureEnvironmentalComplianceTables error:", e));

  if (MONITOR_JOB_ENABLED) {
    setTimeout(() => {
      const runScheduledMonitor = async () => {
        if (monitorJobInFlight) return;
        monitorJobInFlight = true;
        try {
          const result = await runMonitorJob();
          console.log(
            `[monitor-schedule] done — processed=${result.processed} triggered=${result.triggered} errors=${result.errors}`,
          );
        } catch (error) {
          console.error("[monitor-schedule] job error:", error);
        } finally {
          monitorJobInFlight = false;
        }
      };

      runScheduledMonitor().catch(() => {});
      setInterval(runScheduledMonitor, Math.max(60_000, MONITOR_JOB_INTERVAL_MS));
    }, Math.max(1_000, MONITOR_JOB_INITIAL_DELAY_MS));
  }
});
