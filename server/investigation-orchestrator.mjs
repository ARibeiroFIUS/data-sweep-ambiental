import crypto from "node:crypto";
import {
  cleanDocument,
  mapWithConcurrency,
  normalizePersonName,
  parseDelimitedLine,
  resolveHeaderIndexAny,
  toNumber,
} from "./common-utils.mjs";
import { fetchWithTimeout } from "./http-utils.mjs";
import { calculateScore } from "./risk-scoring.mjs";
import { getIndexedSourceMatch, getLatestSnapshotAt, isSourceIndexStoreEnabled } from "./source-index-store.mjs";
import { getSourceConfig, isSourceEnabled } from "./source-registry.mjs";
import { lookupCompaniesByCpf } from "./bigquery-reverse-lookup.mjs";
import {
  buildCpfMaskedFromFull,
  lookupCompaniesByMaskedProfile,
} from "./brasilio-reverse-lookup.mjs";
import {
  appendInvestigationEvent,
  createInvestigationRun,
  dequeueInvestigationNode,
  enqueueInvestigationNode,
  getInvestigationEvents,
  getInvestigationGraph,
  getInvestigationJudicialCoverage,
  getInvestigationJudicialProcesses,
  getInvestigationJudicialSummary,
  getInvestigationRun,
  getInvestigationStats,
  getInvestigationSummary,
  listActiveTribunalCatalog,
  insertInvestigationEdge,
  insertInvestigationFinding,
  insertInvestigationJudicialProcesses,
  listRecoverableInvestigationRuns,
  recoverStaleInvestigationRuns,
  upsertInvestigationJudicialCoverage,
  upsertTribunalCatalog,
  updateInvestigationNode,
  updateInvestigationRun,
  isInvestigationStoreEnabled,
} from "./investigation-store.mjs";
import {
  buildEdgeId,
  buildFindingId,
  buildPfNodeId,
  deriveObligationRelationships,
  maskCnpj,
  maskDocument,
  normalizeVerificationStatus,
  sha256Hex,
} from "./investigation-helpers.mjs";
import { getDefaultTribunalCatalog, TRIBUNAL_CATALOG_VERSION } from "./judicial-catalog.mjs";
import { runJudicialConnectorQuery } from "./judicial-connectors.mjs";
import { queryDatajudTribunal } from "./datajud-query.mjs";

const PORTAL_TRANSPARENCIA_API_KEY = (process.env.PORTAL_TRANSPARENCIA_API_KEY ?? "").trim();
const ROOT_AGENT = "orchestrator";
const QSA_AGENT = "QSAExplorerAgent";
const SANCTIONS_CNPJ_AGENT = "SanctionsCnpjAgent";
const SANCTIONS_CPF_AGENT = "SanctionsCpfAgent";
const REVERSE_AGENT = "ReverseLookupAgent";
const NETWORK_AGENT = "NetworkPatternsAgent";
const OBLIGATIONS_AGENT = "ObligationsMapperAgent";
const JUDICIAL_AGENT = "JudicialCoverageAgent";

const HARD_MAX_DEPTH = Number.parseInt(process.env.INVESTIGATION_HARD_MAX_DEPTH ?? "8", 10);
const HARD_MAX_ENTITIES = Number.parseInt(process.env.INVESTIGATION_HARD_MAX_ENTITIES ?? "2500", 10);
const HARD_MAX_SECONDS = Number.parseInt(process.env.INVESTIGATION_HARD_MAX_SECONDS ?? "7200", 10);
const HARD_MAX_NODE_CONCURRENCY = Number.parseInt(process.env.INVESTIGATION_HARD_MAX_NODE_CONCURRENCY ?? "8", 10);

const DEFAULT_MAX_DEPTH = Number.parseInt(process.env.INVESTIGATION_MAX_DEPTH ?? "5", 10);
const DEFAULT_MAX_ENTITIES = Number.parseInt(process.env.INVESTIGATION_MAX_ENTITIES ?? "1200", 10);
const DEFAULT_MAX_SECONDS = Number.parseInt(process.env.INVESTIGATION_MAX_SECONDS ?? "1500", 10);
const DEFAULT_RELEVANCE_THRESHOLD = Number.parseFloat(process.env.INVESTIGATION_RELEVANCE_THRESHOLD ?? "0.3");
const NODE_CONCURRENCY = Math.max(
  1,
  Math.min(HARD_MAX_NODE_CONCURRENCY, Number.parseInt(process.env.INVESTIGATION_NODE_CONCURRENCY ?? "4", 10)),
);
const JUDICIAL_TRIBUNAL_CONCURRENCY = Number.parseInt(process.env.JUDICIAL_TRIBUNAL_CONCURRENCY ?? "12", 10);
const JUDICIAL_MAX_TRIBUNAIS_PER_ENTITY = Number.parseInt(process.env.JUDICIAL_MAX_TRIBUNAIS_PER_ENTITY ?? "120", 10);
const JUDICIAL_DATAJUD_ENRICH_CONCURRENCY = Number.parseInt(
  process.env.JUDICIAL_DATAJUD_ENRICH_CONCURRENCY ?? "3",
  10,
);
const JUDICIAL_DATAJUD_ENRICH_LIMIT = Number.parseInt(process.env.JUDICIAL_DATAJUD_ENRICH_LIMIT ?? "12", 10);
const JUDICIAL_DATAJUD_ENRICH_TIMEOUT_MS = Number.parseInt(
  process.env.JUDICIAL_DATAJUD_ENRICH_TIMEOUT_MS ?? "12000",
  10,
);
const BRASILIO_REVERSE_SCANS_PER_RUN = Number.parseInt(
  process.env.BRASILIO_REVERSE_SCANS_PER_RUN ?? "20",
  10,
);

const TCU_LICITANTES_URL =
  "https://sites.tcu.gov.br/dados-abertos/inidoneos-irregulares/arquivos/licitantes-inidoneos.csv";
const TCU_ELEITORAL_URL =
  "https://sites.tcu.gov.br/dados-abertos/inidoneos-irregulares/arquivos/resp-contas-julgadas-irreg-implicacao-eleitoral.csv";
const MTE_TRABALHO_ESCRAVO_URL =
  "https://www.gov.br/trabalho-e-emprego/pt-br/assuntos/inspecao-do-trabalho/areas-de-atuacao/cadastro_de_empregadores.csv";

/** @type {Map<string, Promise<void>>} */
const activeRuns = new Map();
/** @type {Map<string, string>} */
const sensitiveCpfCache = new Map();
/** @type {Map<string, { fetchedAt: number, value: string }>} */
const textCache = new Map();
/** @type {{ fetchedAt: number, cpfs: Set<string> } | null} */
let tcuEleitoralCache = null;
let tribunalCatalogSeededAt = 0;
/** @type {Map<string, number>} */
const brazilioScanUsageByRun = new Map();

function buildNodeIdForCnpj(cnpj) {
  const clean = cleanDocument(cnpj);
  return clean.length === 14 ? `PJ:${clean}` : "";
}

function classifyNodeFromId(nodeId) {
  if (String(nodeId).startsWith("PJ:")) return "PJ";
  if (String(nodeId).startsWith("PFH:") || String(nodeId).startsWith("PFMASK:")) return "PF";
  if (String(nodeId).startsWith("SOURCE:")) return "SOURCE";
  if (String(nodeId).startsWith("ORGAO:")) return "ORGAO";
  return "UNKNOWN";
}

function cpfCacheKey(runId, nodeId) {
  return `${runId}:${nodeId}`;
}

function clampInt(value, min, max) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) return min;
  return Math.max(min, Math.min(max, parsed));
}

function cacheCpf(runId, nodeId, cpf) {
  const cleanCpf = cleanDocument(cpf);
  if (cleanCpf.length !== 11) return;
  sensitiveCpfCache.set(cpfCacheKey(runId, nodeId), cleanCpf);
}

function canRunBrasilioScan(runId) {
  const maxScans = Math.max(0, Number(BRASILIO_REVERSE_SCANS_PER_RUN) || 0);
  if (maxScans === 0) return false;
  const used = brazilioScanUsageByRun.get(runId) ?? 0;
  return used < maxScans;
}

function consumeBrasilioScan(runId) {
  const used = brazilioScanUsageByRun.get(runId) ?? 0;
  brazilioScanUsageByRun.set(runId, used + 1);
}

function getCachedCpf(runId, nodeId) {
  return sensitiveCpfCache.get(cpfCacheKey(runId, nodeId)) ?? "";
}

function safeDate(value) {
  if (!value) return null;
  const dt = value instanceof Date ? value : new Date(value);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

async function fetchTextCached(url, timeoutMs = 10000, ttlMs = 6 * 60 * 60 * 1000) {
  const cached = textCache.get(url);
  if (cached && Date.now() - cached.fetchedAt < ttlMs) return cached.value;

  const response = await fetchWithTimeout(url, timeoutMs);
  if (!response || !response.ok) {
    throw new Error(`Falha ao consultar ${url}`);
  }
  const value = await response.text();
  textCache.set(url, { fetchedAt: Date.now(), value });
  return value;
}

function findCsvMatchesByDocument(csvText, delimiter, possibleDocumentHeaders, targetDocument, possibleSampleHeaders = []) {
  const lines = String(csvText ?? "").split(/\r?\n/);
  if (lines.length === 0) return { count: 0, sampleValues: [] };

  const headers = parseDelimitedLine(lines[0], delimiter);
  const documentIndex = resolveHeaderIndexAny(headers, possibleDocumentHeaders);
  const sampleIndex = resolveHeaderIndexAny(headers, possibleSampleHeaders);
  if (documentIndex < 0) return { count: 0, sampleValues: [] };

  let count = 0;
  const samples = new Set();
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line) continue;
    const cols = parseDelimitedLine(line, delimiter);
    const document = cleanDocument(cols[documentIndex] ?? "");
    if (document !== targetDocument) continue;
    count += 1;
    if (sampleIndex >= 0) {
      const sample = String(cols[sampleIndex] ?? "").trim();
      if (sample) samples.add(sample);
    }
  }

  return { count, sampleValues: Array.from(samples).slice(0, 3) };
}

async function loadTcuEleitoralCpfSet() {
  const source = getSourceConfig("tcu_eleitoral");
  if (tcuEleitoralCache && Date.now() - tcuEleitoralCache.fetchedAt < source.ttlMs) {
    return tcuEleitoralCache;
  }

  const csv = await fetchTextCached(TCU_ELEITORAL_URL, source.timeoutMs, source.ttlMs || 6 * 60 * 60 * 1000);
  const lines = csv.split(/\r?\n/);
  const cpfs = new Set();

  if (lines.length > 0) {
    const headers = parseDelimitedLine(lines[0], "|");
    const cpfIndex = resolveHeaderIndexAny(headers, ["CPF"]);

    for (let i = 1; i < lines.length; i += 1) {
      const line = lines[i];
      if (!line) continue;
      const cols = parseDelimitedLine(line, "|");
      const cpf = cleanDocument(cols[cpfIndex] ?? "");
      if (cpf.length === 11) cpfs.add(cpf);
    }
  }

  tcuEleitoralCache = { fetchedAt: Date.now(), cpfs };
  return tcuEleitoralCache;
}

function extractRecordDocuments(record) {
  const candidates = [
    record?.sancionado?.codigoFormatado,
    record?.sancionado?.cnpjFormatado,
    record?.sancionado?.cnpj,
    record?.pessoa?.cnpjFormatado,
    record?.pessoa?.cnpj,
    record?.pessoaJuridica?.cnpjFormatado,
    record?.pessoaJuridica?.cnpj,
    record?.cpfCnpj,
    record?.codigoSancionado,
  ];

  const sancoes = Array.isArray(record?.sancoes) ? record.sancoes : [];
  for (const item of sancoes) {
    candidates.push(item?.cnpjFormatado, item?.cnpj);
  }

  return candidates.map((value) => cleanDocument(value)).filter((value) => value.length === 14);
}

async function fetchCguRecords({ sourceId, endpoint, queryParamName, document }) {
  if (!PORTAL_TRANSPARENCIA_API_KEY) {
    return { status: "unavailable", records: [], status_reason: "missing_api_key" };
  }
  if (!isSourceEnabled(sourceId)) {
    return { status: "unavailable", records: [], status_reason: "feature_disabled" };
  }

  const source = getSourceConfig(sourceId);
  const url = `https://api.portaldatransparencia.gov.br/api-de-dados/${endpoint}?${queryParamName}=${document}&pagina=1`;
  const response = await fetchWithTimeout(url, source.timeoutMs, {
    headers: {
      "chave-api-dados": PORTAL_TRANSPARENCIA_API_KEY,
      accept: "application/json",
    },
  });

  if (!response) return { status: "unavailable", records: [], status_reason: "timeout_or_network" };
  if (response.status === 401 || response.status === 403) {
    return { status: "unavailable", records: [], status_reason: "unauthorized" };
  }
  if (response.status === 429) return { status: "error", records: [], status_reason: "rate_limited" };
  if (!response.ok) return { status: "error", records: [], status_reason: `http_${response.status}` };

  const payload = await response.json().catch(() => null);
  const allRecords = Array.isArray(payload) ? payload : [];
  const cleanDoc = cleanDocument(document);
  const records =
    cleanDoc.length === 14
      ? allRecords.filter((record) => extractRecordDocuments(record).includes(cleanDoc))
      : allRecords;

  return {
    status: records.length > 0 ? "success" : "not_found",
    records,
    status_reason: records.length > 0 ? "match_found" : "not_listed",
  };
}

async function fetchCompanyByCnpj(cnpj) {
  const response = await fetchWithTimeout(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, 12000);
  if (!response || !response.ok) return null;
  const payload = await response.json().catch(() => null);
  if (!payload || typeof payload !== "object") return null;
  return payload;
}

function toQsaEntries(company) {
  const qsa = Array.isArray(company?.qsa) ? company.qsa : [];
  return qsa.map((entry) => {
    const tipo = entry?.identificador_de_socio === 1 ? "PJ" : "PF";
    return {
      tipo,
      nome: String(entry?.nome_socio ?? entry?.nome ?? "").trim(),
      qual: String(entry?.qualificacao_socio ?? entry?.qual ?? "").trim(),
      documentoRaw: String(entry?.cnpj_cpf_do_socio ?? "").trim(),
      documentoClean: cleanDocument(entry?.cnpj_cpf_do_socio ?? ""),
    };
  });
}

function toSeverityClass(score) {
  if (score >= 70) return "Crítico";
  if (score >= 45) return "Alto";
  if (score >= 20) return "Médio";
  return "Baixo";
}

function buildNodeFlag(flag, nodeDepth, sourceId = null) {
  const verificationStatus = normalizeVerificationStatus(flag);
  return {
    id: flag.id,
    source: flag.source,
    source_id: sourceId ?? flag.source_id ?? null,
    severity: flag.severity,
    title: flag.title,
    description: flag.description,
    weight: Number(flag.weight ?? 0),
    depth: nodeDepth,
    confidence_level: flag.confidence_level ?? (verificationStatus === "probable" ? "PROVAVEL" : "CONFIRMADO"),
    confidence: flag.confidence ?? null,
    verification_status: verificationStatus,
    evidence: Array.isArray(flag.evidence) ? flag.evidence : [],
  };
}

function sourceNodeId(sourceId) {
  return `SOURCE:${sourceId}`;
}

function orgaoNodeId(name) {
  const normalized = normalizePersonName(name);
  return `ORGAO:${sha256Hex(normalized).slice(0, 24)}`;
}

async function ensureReferenceNode(runId, node) {
  await enqueueInvestigationNode({
    runId,
    nodeId: node.nodeId,
    entityType: node.entityType,
    displayName: node.displayName,
    documentMasked: node.documentMasked ?? "",
    documentHash: node.documentHash ?? "",
    depth: node.depth ?? 0,
    sourceAgent: node.sourceAgent ?? ROOT_AGENT,
    priority: 0,
    metadata: node.metadata ?? {},
  });
  await updateInvestigationNode(runId, node.nodeId, {
    status: "done",
    riskScore: 0,
    riskClassification: "Baixo",
    restrictionCount: 0,
  });
}

async function persistFindings(runId, node, rawFlags) {
  const persisted = [];
  for (const flag of rawFlags) {
    const verificationStatus = normalizeVerificationStatus(flag);
    const evidence = Array.isArray(flag.evidence) ? flag.evidence : [];
    if (verificationStatus === "objective" && evidence.length === 0) {
      await appendInvestigationEvent({
        runId,
        level: "warn",
        agent: SANCTIONS_CNPJ_AGENT,
        message: `Flag ${flag.id} ignorada por falta de evidência mínima`,
        payload: { node_id: node.node_id, flag_id: flag.id },
      });
      continue;
    }

    const finding = {
      findingId: buildFindingId({
        nodeId: node.node_id,
        flagId: flag.id,
        sourceId: flag.source_id ?? flag.source,
        title: flag.title,
      }),
      runId,
      entityNodeId: node.node_id,
      flagId: flag.id,
      severity: flag.severity,
      title: flag.title,
      description: flag.description,
      weight: Number(flag.weight ?? 0),
      depth: Number(flag.depth ?? node.depth ?? 0),
      confidenceLevel: flag.confidence_level ?? null,
      confidence: flag.confidence ?? null,
      verificationStatus,
      sourceId: flag.source_id ?? null,
      evidence,
    };
    await insertInvestigationFinding(finding);
    persisted.push(buildNodeFlag(flag, node.depth, flag.source_id));

    if (flag.source_id) {
      const sourceIdNode = sourceNodeId(flag.source_id);
      await ensureReferenceNode(runId, {
        nodeId: sourceIdNode,
        entityType: "SOURCE",
        displayName: flag.source ?? flag.source_id,
        sourceAgent: SANCTIONS_CNPJ_AGENT,
      });
      await insertInvestigationEdge({
        runId,
        edgeId: buildEdgeId(node.node_id, sourceIdNode, "SANCIONADO_EM", flag.source_id),
        sourceNodeId: node.node_id,
        targetNodeId: sourceIdNode,
        relationship: "SANCIONADO_EM",
        obligationCode: null,
        obligationLabel: null,
        confidence: 1,
        sourceBase: flag.source ?? flag.source_id,
        metadata: { flag_id: flag.id },
      });
    }
  }

  return persisted;
}

async function queryHeavyCsvSanctions(cnpj) {
  const heavyFlags = [];

  if (isSourceEnabled("tcu_licitantes")) {
    try {
      const source = getSourceConfig("tcu_licitantes");
      const csv = await fetchTextCached(TCU_LICITANTES_URL, source.timeoutMs, source.ttlMs || 6 * 60 * 60 * 1000);
      const matches = findCsvMatchesByDocument(csv, "|", ["CPF_CNPJ", "CPF/CNPJ"], cnpj, ["PROCESSO", "NR_PROCESSO"]);
      if (matches.count > 0) {
        heavyFlags.push({
          id: "tcu_licitantes_inidoneos",
          source_id: "tcu_licitantes",
          source: "TCU",
          severity: "critical",
          title: "Empresa em lista do TCU (Licitantes Inidôneos)",
          description: `Foram encontrados ${matches.count} registro(s) na base de licitantes inidôneos.`,
          weight: 35,
          evidence: [{ label: "Registros encontrados", value: String(matches.count) }],
        });
      }
    } catch {
      // fail-open
    }
  }

  if (isSourceEnabled("mte_trabalho_escravo")) {
    try {
      const source = getSourceConfig("mte_trabalho_escravo");
      const csv = await fetchTextCached(
        MTE_TRABALHO_ESCRAVO_URL,
        source.timeoutMs,
        source.ttlMs || 6 * 60 * 60 * 1000,
      );
      const matches = findCsvMatchesByDocument(
        csv,
        ";",
        ["CNPJ/CPF", "CPF_CNPJ", "CNPJ_CPF"],
        cnpj,
        ["Empregador", "NOME_EMPREGADOR"],
      );
      if (matches.count > 0) {
        heavyFlags.push({
          id: "mte_trabalho_escravo",
          source_id: "mte_trabalho_escravo",
          source: "MTE",
          severity: "critical",
          title: "Empresa no cadastro de trabalho escravo",
          description:
            `Foram encontradas ${matches.count} ocorrência(s) no cadastro de empregadores ` +
            "que submeteram trabalhadores a condições análogas à escravidão.",
          weight: 35,
          evidence: [{ label: "Ocorrências", value: String(matches.count) }],
        });
      }
    } catch {
      // fail-open
    }
  }

  return heavyFlags;
}

async function queryPgfns(cnpj) {
  const flags = [];
  if (!isSourceIndexStoreEnabled()) return flags;

  const defs = [
    {
      sourceId: "pgfn_fgts",
      id: "pgfn_fgts_divida_ativa",
      title: "Empresa com inscrição em dívida ativa (FGTS)",
      description: "A empresa consta em dados abertos de dívida ativa FGTS da PGFN.",
      weight: 15,
      severity: "medium",
    },
    {
      sourceId: "pgfn_previdenciario",
      id: "pgfn_previd_divida_ativa",
      title: "Empresa com dívida ativa previdenciária",
      description: "A empresa consta em dados abertos de dívida ativa previdenciária da PGFN.",
      weight: 15,
      severity: "medium",
    },
    {
      sourceId: "pgfn_nao_previdenciario",
      id: "pgfn_np_divida_ativa",
      title: "Empresa com dívida ativa não-previdenciária",
      description: "A empresa consta em dados abertos de dívida ativa não-previdenciária da PGFN.",
      weight: 20,
      severity: "medium",
    },
  ];

  await mapWithConcurrency(defs, 3, async (def) => {
    if (!isSourceEnabled(def.sourceId)) return;

    let snapshot = null;
    try {
      snapshot = await getLatestSnapshotAt([def.sourceId]);
    } catch {
      snapshot = null;
    }
    if (!snapshot) return;

    const match = await getIndexedSourceMatch(def.sourceId, cnpj).catch(() => null);
    if (!match) return;

    flags.push({
      id: def.id,
      source_id: def.sourceId,
      source: "PGFN",
      severity: def.severity,
      title: def.title,
      description: def.description,
      weight: def.weight,
      evidence: [{ label: "Documento", value: cnpj }],
    });
  });

  return flags;
}

async function queryCnpjSanctions(cnpj, includeHeavy) {
  const flags = [];
  const sourceErrors = [];

  const cguDefs = [
    {
      sourceId: "cgu_ceis",
      endpoint: "ceis",
      param: "codigoSancionado",
      id: "ceis",
      severity: "critical",
      title: "Empresa no CEIS",
      description: "Cadastrada no Cadastro de Empresas Inidôneas e Suspensas.",
      weight: 35,
      evidenceFields: [
        ["numeroProcesso", "Processo"],
        ["orgaoSancionador.nome", "Órgão sancionador"],
        ["dataInicioSancao", "Início da sanção"],
        ["dataFimSancao", "Fim da sanção"],
      ],
    },
    {
      sourceId: "cgu_cnep",
      endpoint: "cnep",
      param: "codigoSancionado",
      id: "cnep",
      severity: "critical",
      title: "Empresa no CNEP",
      description: "Cadastrada no Cadastro Nacional de Empresas Punidas.",
      weight: 35,
      evidenceFields: [
        ["numeroProcesso", "Processo"],
        ["orgaoSancionador.nome", "Órgão"],
        ["dataPublicacaoSancao", "Data publicação"],
      ],
    },
    {
      sourceId: "cgu_cepim",
      endpoint: "cepim",
      param: "cnpjSancionado",
      id: "cepim",
      severity: "high",
      title: "Entidade no CEPIM",
      description: "Cadastrada no CEPIM.",
      weight: 25,
      evidenceFields: [
        ["orgaoResponsavel.nome", "Órgão"],
        ["motivo", "Motivo"],
      ],
    },
    {
      sourceId: "cgu_acordos_leniencia",
      endpoint: "acordos-leniencia",
      param: "cnpjSancionado",
      id: "cgu_acordo_leniencia",
      severity: "critical",
      title: "Empresa com acordo de leniência",
      description: "A empresa consta na base de acordos de leniência da CGU.",
      weight: 30,
      evidenceFields: [
        ["situacaoAcordo", "Situação"],
        ["orgaoResponsavel.nome", "Órgão"],
      ],
    },
  ];

  await mapWithConcurrency(cguDefs, 4, async (def) => {
    const result = await fetchCguRecords({
      sourceId: def.sourceId,
      endpoint: def.endpoint,
      queryParamName: def.param,
      document: cnpj,
    });

    if (result.status === "error" || result.status === "unavailable") {
      sourceErrors.push({ source: def.sourceId, reason: result.status_reason });
      return;
    }
    if (result.status !== "success") return;

    const sample = result.records[0] ?? null;
    const evidence = [];
    for (const [path, label] of def.evidenceFields) {
      const value = path.split(".").reduce((obj, key) => (obj && obj[key] !== undefined ? obj[key] : null), sample);
      if (value !== null && value !== undefined && String(value).trim()) {
        evidence.push({ label, value: String(value).trim() });
      }
    }
    if (evidence.length === 0) {
      evidence.push({ label: "Documento", value: cnpj });
    }

    flags.push({
      id: def.id,
      source_id: def.sourceId,
      source: def.sourceId.startsWith("cgu") ? "CGU" : def.sourceId,
      severity: def.severity,
      title: def.title,
      description: def.description,
      weight: def.weight,
      evidence,
    });
  });

  const [pgfnFlags, heavyFlags] = await Promise.all([
    queryPgfns(cnpj),
    includeHeavy ? queryHeavyCsvSanctions(cnpj) : Promise.resolve([]),
  ]);
  flags.push(...pgfnFlags, ...heavyFlags);

  return { flags, sourceErrors };
}

async function queryCpfSanctions(cpf, displayName) {
  const flags = [];
  const sourceErrors = [];

  const ceaf = await fetchCguRecords({
    sourceId: "cgu_ceaf",
    endpoint: "ceaf",
    queryParamName: "cpfSancionado",
    document: cpf,
  });
  if (ceaf.status === "success") {
    const sample = ceaf.records[0] ?? null;
    flags.push({
      id: "cgu_ceaf_socio_expulso",
      source_id: "cgu_ceaf",
      source: "CGU",
      severity: "high",
      title: "Sócio listado no CEAF",
      description: `${displayName} consta no CEAF.`,
      weight: 25,
      evidence: [
        { label: "Sócio", value: displayName },
        ...(sample?.numeroProcesso ? [{ label: "Processo", value: String(sample.numeroProcesso) }] : []),
      ],
    });
  } else if (ceaf.status === "error" || ceaf.status === "unavailable") {
    sourceErrors.push({ source: "cgu_ceaf", reason: ceaf.status_reason });
  }

  const servidores = await fetchCguRecords({
    sourceId: "cgu_servidores",
    endpoint: "servidores",
    queryParamName: "cpf",
    document: cpf,
  });
  if (servidores.status === "success") {
    const sample = servidores.records[0] ?? null;
    flags.push({
      id: "cgu_socio_servidor_federal",
      source_id: "cgu_servidores",
      source: "CGU",
      severity: "medium",
      title: "Sócio identificado como servidor federal",
      description: `${displayName} possui vínculo com servidor público federal.`,
      weight: 10,
      evidence: [
        { label: "Sócio", value: displayName },
        ...(sample?.orgaoServidorLotacao?.nome
          ? [{ label: "Órgão", value: String(sample.orgaoServidorLotacao.nome) }]
          : []),
      ],
    });
  } else if (servidores.status === "error" || servidores.status === "unavailable") {
    sourceErrors.push({ source: "cgu_servidores", reason: servidores.status_reason });
  }

  if (isSourceEnabled("tcu_eleitoral")) {
    try {
      const eleitoralIndex = await loadTcuEleitoralCpfSet();
      if (eleitoralIndex.cpfs.has(cpf)) {
        flags.push({
          id: "tcu_implicacao_eleitoral_socio",
          source_id: "tcu_eleitoral",
          source: "TCU",
          severity: "high",
          title: "Sócio listado em contas irregulares com implicação eleitoral",
          description: `${displayName} consta na base de implicação eleitoral do TCU por CPF.`,
          weight: 20,
          evidence: [{ label: "Sócio", value: displayName }],
        });
      }
    } catch {
      sourceErrors.push({ source: "tcu_eleitoral", reason: "index_load_failed" });
    }
  }

  return { flags, sourceErrors };
}

async function processPjNode(run, node) {
  const cnpj = cleanDocument(node?.metadata_json?.cnpj ?? node.node_id.replace(/^PJ:/, ""));
  if (cnpj.length !== 14) {
    await updateInvestigationNode(run.id, node.node_id, { status: "skipped", metadataJson: { reason: "invalid_cnpj" } });
    return { sourceErrors: false };
  }

  await appendInvestigationEvent({
    runId: run.id,
    level: "info",
    agent: QSA_AGENT,
    message: `Investigando PJ ${cnpj}`,
    payload: { node_id: node.node_id, depth: node.depth },
  });

  const [company, sanctions] = await Promise.all([
    fetchCompanyByCnpj(cnpj),
    queryCnpjSanctions(cnpj, node.depth <= 1),
  ]);

  const qsaEntries = toQsaEntries(company);
  const nextDepth = Number(node.depth ?? 0) + 1;

  for (const partner of qsaEntries) {
    if (nextDepth > run.max_depth) continue;

    if (partner.tipo === "PJ") {
      if (partner.documentoClean.length !== 14) continue;
      const partnerNodeId = buildNodeIdForCnpj(partner.documentoClean);
      if (!partnerNodeId) continue;

      if (nextDepth <= run.max_depth) {
        await enqueueInvestigationNode({
          runId: run.id,
          nodeId: partnerNodeId,
          entityType: "PJ",
          displayName: partner.nome || partner.documentoClean,
          documentMasked: maskCnpj(partner.documentoClean),
          documentHash: sha256Hex(partner.documentoClean),
          depth: nextDepth,
          sourceAgent: QSA_AGENT,
          priority: 0.7,
          metadata: { cnpj: partner.documentoClean, qualification: partner.qual },
        });
      }

      const relationships = deriveObligationRelationships(partner.qual, "PJ");
      for (const rel of relationships) {
        await insertInvestigationEdge({
          runId: run.id,
          edgeId: buildEdgeId(partnerNodeId, node.node_id, rel.relationship, rel.obligationCode),
          sourceNodeId: partnerNodeId,
          targetNodeId: node.node_id,
          relationship: rel.relationship,
          obligationCode: rel.obligationCode,
          obligationLabel: rel.obligationLabel,
          confidence: 1,
          sourceBase: "Receita Federal",
          metadata: { qualification: partner.qual },
        });
      }
      continue;
    }

    const cpfFull = partner.documentoClean.length === 11 ? partner.documentoClean : "";
    const pfNodeId = buildPfNodeId({
      nome: partner.nome,
      cpfFull,
      cpfMasked: partner.documentoRaw,
      parentCnpj: cnpj,
    });
    cacheCpf(run.id, pfNodeId, cpfFull);
    await enqueueInvestigationNode({
      runId: run.id,
      nodeId: pfNodeId,
      entityType: "PF",
      displayName: partner.nome || "Sócio PF",
      documentMasked: maskDocument(partner.documentoRaw),
      documentHash: sha256Hex(cpfFull || `${partner.nome}|${partner.documentoRaw}`),
      depth: nextDepth,
      sourceAgent: QSA_AGENT,
      priority: cpfFull ? 0.9 : 0.4,
      metadata: {
        cpf_hash: cpfFull ? sha256Hex(cpfFull) : null,
        cpf_masked: partner.documentoRaw || null,
        nome: partner.nome || null,
        qualification: partner.qual || null,
      },
    });

    const relationships = deriveObligationRelationships(partner.qual, "PF");
    for (const rel of relationships) {
      await insertInvestigationEdge({
        runId: run.id,
        edgeId: buildEdgeId(pfNodeId, node.node_id, rel.relationship, rel.obligationCode),
        sourceNodeId: pfNodeId,
        targetNodeId: node.node_id,
        relationship: rel.relationship,
        obligationCode: rel.obligationCode,
        obligationLabel: rel.obligationLabel,
        confidence: 1,
        sourceBase: "Receita Federal",
        metadata: { qualification: partner.qual },
      });
    }
  }

  const nodeFlags = await persistFindings(
    run.id,
    node,
    sanctions.flags.map((flag) => buildNodeFlag(flag, node.depth, flag.source_id)),
  );

  const { score, classification } = calculateScore(
    nodeFlags.map((flag) => ({
      weight: flag.weight,
      depth: node.depth,
      confidence_level: flag.confidence_level,
      verification_status: flag.verification_status,
    })),
  );

  await updateInvestigationNode(run.id, node.node_id, {
    status: "done",
    displayName: company?.razao_social ?? node.display_name,
    riskScore: score,
    riskClassification: classification,
    restrictionCount: nodeFlags.length,
    metadataJson: {
      cnpj,
      uf: company?.uf ?? "",
      municipio: company?.municipio ?? "",
      situacao_cadastral: company?.descricao_situacao_cadastral ?? "",
      capital_social: toNumber(company?.capital_social ?? 0),
      data_inicio_atividade: company?.data_inicio_atividade ?? "",
      qsa_size: qsaEntries.length,
      source_errors: sanctions.sourceErrors,
      obligations_agent: OBLIGATIONS_AGENT,
    },
  });

  return { sourceErrors: sanctions.sourceErrors.length > 0 };
}

async function processPfNode(run, node) {
  const cpf = getCachedCpf(run.id, node.node_id);
  const displayName = String(node.display_name ?? node?.metadata_json?.nome ?? "Sócio PF").trim();
  const cpfMaskedFromNode = String(node?.metadata_json?.cpf_masked ?? "").trim();
  const cpfMasked = cpfMaskedFromNode || buildCpfMaskedFromFull(cpf);

  await appendInvestigationEvent({
    runId: run.id,
    level: "info",
    agent: SANCTIONS_CPF_AGENT,
    message: `Investigando PF ${displayName}`,
    payload: { node_id: node.node_id, depth: node.depth },
  });

  const allFlags = [];
  const sourceErrors = [];
  const relatedCompanies = new Map();
  const reverseProviders = [];

  function mergeRelatedCompanies(items, provider, confidence = 0.7) {
    for (const company of items ?? []) {
      const cnpj = cleanDocument(company?.cnpj ?? "");
      if (cnpj.length !== 14) continue;

      const existing = relatedCompanies.get(cnpj) ?? {
        cnpj,
        razao_social: String(company?.razao_social ?? "").trim(),
        uf: String(company?.uf ?? "").trim(),
        municipio: String(company?.municipio ?? "").trim(),
        situacao_cadastral: String(company?.situacao_cadastral ?? "").trim(),
        providers: new Set(),
        confidence,
      };

      if (!existing.razao_social && company?.razao_social) {
        existing.razao_social = String(company.razao_social).trim();
      }
      if (!existing.uf && company?.uf) {
        existing.uf = String(company.uf).trim();
      }
      if (!existing.municipio && company?.municipio) {
        existing.municipio = String(company.municipio).trim();
      }
      if (!existing.situacao_cadastral && company?.situacao_cadastral) {
        existing.situacao_cadastral = String(company.situacao_cadastral).trim();
      }

      existing.providers.add(provider);
      existing.confidence = Math.max(existing.confidence, confidence);
      relatedCompanies.set(cnpj, existing);
    }
  }

  if (cpf.length === 11) {
    const cpfSanctions = await queryCpfSanctions(cpf, displayName);
    allFlags.push(...cpfSanctions.flags);
    sourceErrors.push(...cpfSanctions.sourceErrors);

    const reverseResult = await lookupCompaniesByCpf(cpf, 25);
    if (reverseResult.status === "success") {
      mergeRelatedCompanies(reverseResult.items, "bigquery", 1);
      reverseProviders.push({
        source: "bigquery",
        status: "success",
        reason: reverseResult.reason ?? "ok",
        count: reverseResult.items.length,
      });
    } else if (reverseResult.status === "error" || reverseResult.status === "unavailable") {
      sourceErrors.push({ source: "reverse_lookup_bigquery", reason: reverseResult.reason });
      reverseProviders.push({
        source: "bigquery",
        status: reverseResult.status,
        reason: reverseResult.reason ?? "unknown",
        count: 0,
      });
    } else {
      reverseProviders.push({
        source: "bigquery",
        status: reverseResult.status,
        reason: reverseResult.reason ?? "no_related_companies",
        count: 0,
      });
    }
  } else if (!cpfMasked) {
    await appendInvestigationEvent({
      runId: run.id,
      level: "warn",
      agent: SANCTIONS_CPF_AGENT,
      message: `CPF completo e CPF mascarado indisponíveis para ${displayName}; reverse lookup não executado`,
      payload: { node_id: node.node_id },
    });
  }

  // Fallback barato: brasil.io socios-brasil (nome + CPF mascarado).
  if (cpfMasked && displayName) {
    const allowBrasilioScan = canRunBrasilioScan(run.id);
    const brazilioResult = await lookupCompaniesByMaskedProfile({
      cpfMasked,
      nome: displayName,
      limit: 25,
      allowScanOnMiss: allowBrasilioScan,
    });
    if (brazilioResult.scan_executed) {
      consumeBrasilioScan(run.id);
    }

    if (brazilioResult.status === "success") {
      mergeRelatedCompanies(brazilioResult.items, "brasilio", 0.65);
      reverseProviders.push({
        source: "brasilio",
        status: "success",
        reason: brazilioResult.reason ?? "ok",
        count: brazilioResult.items.length,
        from_cache: Boolean(brazilioResult.from_cache),
        source_last_modified: brazilioResult.source_last_modified ?? null,
      });
    } else if (brazilioResult.status === "unavailable" || brazilioResult.status === "error") {
      sourceErrors.push({ source: "reverse_lookup_brasilio", reason: brazilioResult.reason });
      reverseProviders.push({
        source: "brasilio",
        status: brazilioResult.status,
        reason: brazilioResult.reason ?? "unavailable",
        count: 0,
        from_cache: Boolean(brazilioResult.from_cache),
        source_last_modified: brazilioResult.source_last_modified ?? null,
      });
    } else {
      reverseProviders.push({
        source: "brasilio",
        status: brazilioResult.status,
        reason: brazilioResult.reason ?? "no_related_companies",
        count: 0,
        from_cache: Boolean(brazilioResult.from_cache),
        source_last_modified: brazilioResult.source_last_modified ?? null,
      });
    }
  }

  if (Number(node.depth ?? 0) + 1 <= run.max_depth && relatedCompanies.size > 0) {
    for (const company of relatedCompanies.values()) {
      const partnerNodeId = buildNodeIdForCnpj(company.cnpj);
      await enqueueInvestigationNode({
        runId: run.id,
        nodeId: partnerNodeId,
        entityType: "PJ",
        displayName: company.razao_social || company.cnpj,
        documentMasked: maskCnpj(company.cnpj),
        documentHash: sha256Hex(company.cnpj),
        depth: Number(node.depth ?? 0) + 1,
        sourceAgent: REVERSE_AGENT,
        priority: 0.8,
        metadata: {
          cnpj: company.cnpj,
          razao_social: company.razao_social || "",
          uf: company.uf || "",
          municipio: company.municipio || "",
          situacao_cadastral: company.situacao_cadastral || "",
          reverse_providers: Array.from(company.providers),
        },
      });
      const sourceBase = Array.from(company.providers)
        .map((provider) => (provider === "bigquery" ? "BigQuery" : "Brasil.io"))
        .join(" + ");

      await insertInvestigationEdge({
        runId: run.id,
        edgeId: buildEdgeId(node.node_id, partnerNodeId, "SOCIO_DE", "PARTICIPACAO_SOCIETARIA"),
        sourceNodeId: node.node_id,
        targetNodeId: partnerNodeId,
        relationship: "SOCIO_DE",
        obligationCode: "PARTICIPACAO_SOCIETARIA",
        obligationLabel: "Participação societária",
        confidence: company.confidence,
        sourceBase,
        metadata: {
          reverse_lookup: true,
          agent: REVERSE_AGENT,
          providers: Array.from(company.providers),
        },
      });
    }
  }

  const nodeFlags = await persistFindings(
    run.id,
    node,
    allFlags.map((flag) => buildNodeFlag(flag, node.depth, flag.source_id)),
  );

  for (const flag of nodeFlags) {
    if (flag.id !== "cgu_socio_servidor_federal") continue;
    const orgaoEvidence = flag.evidence.find((item) => item.label.toLowerCase().includes("órgão"));
    if (!orgaoEvidence?.value) continue;

    const agencyNodeId = orgaoNodeId(orgaoEvidence.value);
    await ensureReferenceNode(run.id, {
      nodeId: agencyNodeId,
      entityType: "ORGAO",
      displayName: orgaoEvidence.value,
      sourceAgent: SANCTIONS_CPF_AGENT,
    });
    await insertInvestigationEdge({
      runId: run.id,
      edgeId: buildEdgeId(node.node_id, agencyNodeId, "SERVIDOR_DE", "GESTAO_E_REPRESENTACAO"),
      sourceNodeId: node.node_id,
      targetNodeId: agencyNodeId,
      relationship: "SERVIDOR_DE",
      obligationCode: "GESTAO_E_REPRESENTACAO",
      obligationLabel: "Gestão e representação",
      confidence: 1,
      sourceBase: "CGU",
      metadata: { flag_id: flag.id },
    });
  }

  const { score, classification } = calculateScore(
    nodeFlags.map((flag) => ({
      weight: flag.weight,
      depth: node.depth,
      confidence_level: flag.confidence_level,
      verification_status: flag.verification_status,
    })),
  );

  await updateInvestigationNode(run.id, node.node_id, {
    status: "done",
    riskScore: score,
    riskClassification: classification,
    restrictionCount: nodeFlags.length,
    metadataJson: {
      cpf_full_available: cpf.length === 11,
      cpf_masked: cpfMasked || null,
      source_errors: sourceErrors,
      reverse_lookup_enabled: true,
      reverse_lookup_companies: relatedCompanies.size,
      reverse_lookup_providers: reverseProviders,
    },
  });

  return { sourceErrors: sourceErrors.length > 0 };
}

async function ensureTribunalCatalogSeeded(force = false) {
  if (!isInvestigationStoreEnabled()) return 0;
  const ttlMs = 6 * 60 * 60 * 1000;
  if (!force && tribunalCatalogSeededAt > 0 && Date.now() - tribunalCatalogSeededAt < ttlMs) {
    return 0;
  }

  const upserted = await upsertTribunalCatalog(getDefaultTribunalCatalog()).catch(() => 0);
  tribunalCatalogSeededAt = Date.now();
  return upserted;
}

function parseTribunalModes(tribunal) {
  const raw = tribunal?.query_modes_supported_json;
  if (Array.isArray(raw)) return raw.map((item) => String(item));
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.map((item) => String(item));
    } catch {
      return [];
    }
  }
  return [];
}

function sanitizeJudicialProcesses(tribunal, processes) {
  const tribunalId = String(tribunal?.tribunal_id ?? "");
  const tribunalName = String(tribunal?.nome ?? tribunalId).trim() || tribunalId.toUpperCase();
  if (!Array.isArray(processes)) return [];
  const valid = [];

  for (const process of processes) {
    const numeroProcesso = String(process?.numeroProcesso ?? process?.numero_processo ?? "").trim();
    if (!numeroProcesso) continue;

    valid.push({
      ...process,
      numeroProcesso,
      process_key: `${tribunalId}:${numeroProcesso}`,
      evidence: [
        { label: "Tribunal", value: tribunalName },
        { label: "Número do processo", value: numeroProcesso },
        ...(process?.polo ? [{ label: "Polo da empresa", value: String(process.polo) }] : []),
      ],
    });
  }

  return valid;
}

function classifyJudicialSeverity(processes) {
  const text = processes
    .flatMap((process) => [process?.classe?.nome ?? "", ...(process?.assuntos ?? []).map((item) => item?.nome ?? "")])
    .join(" ");
  if (/criminal|penal|improbidade|corrup/i.test(text)) {
    return { severity: "critical", weight: 30, type: "criminal" };
  }
  if (/execução fiscal|dívida ativa|fazenda|tributári/i.test(text)) {
    return { severity: "high", weight: 20, type: "fiscal" };
  }
  if (/trabalhista|reclamação|rescisão|fgts|trt/i.test(text)) {
    return { severity: "medium", weight: 10, type: "trabalhista" };
  }
  return { severity: "low", weight: 5, type: "geral" };
}

function mergeProcessWithDatajud(baseProcess, detailProcess) {
  if (!detailProcess || typeof detailProcess !== "object") return baseProcess;

  const merged = { ...baseProcess };
  if (!merged.classe && detailProcess.classe) merged.classe = detailProcess.classe;
  if ((!Array.isArray(merged.assuntos) || merged.assuntos.length === 0) && Array.isArray(detailProcess.assuntos)) {
    merged.assuntos = detailProcess.assuntos;
  }
  if (!merged.dataAjuizamento && detailProcess.dataAjuizamento) merged.dataAjuizamento = detailProcess.dataAjuizamento;
  if (!merged.ano && detailProcess.ano) merged.ano = detailProcess.ano;
  if (!merged.orgaoJulgador && detailProcess.orgaoJulgador) merged.orgaoJulgador = detailProcess.orgaoJulgador;
  if ((merged.valor === null || merged.valor === undefined) && detailProcess.valor != null) merged.valor = detailProcess.valor;
  if (!merged.grau && detailProcess.grau) merged.grau = detailProcess.grau;

  if (Array.isArray(detailProcess.andamentos) && detailProcess.andamentos.length > 0) {
    merged.andamentos = detailProcess.andamentos.slice(0, 5);
  }

  return merged;
}

async function enrichCrawlerProcessesWithDatajud(tribunalId, processes) {
  if (!Array.isArray(processes) || processes.length === 0) {
    return { processes: [], summary: { applied: false, attempted: 0, enriched: 0, unavailable: 0, failed: 0 } };
  }

  const normalizedTribunalId = String(tribunalId ?? "").toLowerCase();
  const target = processes.filter((item) => String(item?.numeroProcesso ?? "").trim()).slice(0, JUDICIAL_DATAJUD_ENRICH_LIMIT);

  if (target.length === 0) {
    return {
      processes,
      summary: { applied: false, attempted: 0, enriched: 0, unavailable: 0, failed: 0 },
    };
  }

  const details = await mapWithConcurrency(target, JUDICIAL_DATAJUD_ENRICH_CONCURRENCY, async (process) => {
    const numeroProcesso = String(process?.numeroProcesso ?? "").trim();
    const result = await queryDatajudTribunal({
      tribunalId: normalizedTribunalId,
      queryMode: "process_number",
      processNumber: numeroProcesso,
      timeoutMs: JUDICIAL_DATAJUD_ENRICH_TIMEOUT_MS,
    }).catch(() => ({
      status: "error",
      statusReason: "request_failed",
      processes: [],
    }));

    return { numeroProcesso, result };
  });

  const detailByNumber = new Map();
  let enriched = 0;
  let unavailable = 0;
  let failed = 0;

  for (const item of details) {
    const status = String(item?.result?.status ?? "");
    if (status === "success" && Array.isArray(item?.result?.processes) && item.result.processes.length > 0) {
      const exact =
        item.result.processes.find(
          (proc) => String(proc?.numeroProcesso ?? "").trim() === String(item.numeroProcesso ?? "").trim(),
        ) ?? item.result.processes[0];
      detailByNumber.set(item.numeroProcesso, exact);
      enriched += 1;
      continue;
    }

    if (status === "unavailable" || status === "invalid") {
      unavailable += 1;
    } else {
      failed += 1;
    }
  }

  const merged = processes.map((process) => {
    const numero = String(process?.numeroProcesso ?? "").trim();
    const detail = detailByNumber.get(numero);
    if (!detail) return process;
    return mergeProcessWithDatajud(process, detail);
  });

  return {
    processes: merged,
    summary: {
      applied: true,
      attempted: target.length,
      enriched,
      unavailable,
      failed,
    },
  };
}

async function runJudicialCoverageAgent(run) {
  await ensureTribunalCatalogSeeded().catch(() => {});
  const tribunais = await listActiveTribunalCatalog().catch(() => []);
  if (tribunais.length === 0) {
    await appendInvestigationEvent({
      runId: run.id,
      level: "warn",
      agent: JUDICIAL_AGENT,
      message: "Catálogo de tribunais indisponível para varredura judicial",
      payload: { reason: "empty_catalog" },
    });
    return { sourceErrors: true };
  }

  const rootNodeId = buildNodeIdForCnpj(run.root_cnpj);
  const company = await fetchCompanyByCnpj(run.root_cnpj).catch(() => null);
  const companyName = String(company?.razao_social ?? "").trim();
  const selectedTribunais = tribunais.slice(0, Math.max(1, JUDICIAL_MAX_TRIBUNAIS_PER_ENTITY));

  await appendInvestigationEvent({
    runId: run.id,
    level: "info",
    agent: JUDICIAL_AGENT,
    message: "Varredura judicial nacional iniciada",
    payload: {
      tribunais_total_catalogo: tribunais.length,
      tribunais_planejados: selectedTribunais.length,
      connector_catalog_version: TRIBUNAL_CATALOG_VERSION,
    },
  });

  let unavailableObserved = false;
  let foundProcesses = 0;

  await mapWithConcurrency(selectedTribunais, JUDICIAL_TRIBUNAL_CONCURRENCY, async (tribunal) => {
    const modes = parseTribunalModes(tribunal);
    const queryModes = [];
    if (modes.includes("cnpj_exact")) queryModes.push("cnpj_exact");
    if (modes.includes("party_name") && companyName) queryModes.push("party_name");
    if (modes.includes("process_number") && queryModes.length === 0) queryModes.push("process_number");
    if (queryModes.length === 0) queryModes.push("cnpj_exact");

    for (const queryMode of queryModes) {
      const connectorResult = await runJudicialConnectorQuery({
        tribunal,
        queryMode,
        document: run.root_cnpj,
        name: companyName,
        runId: run.id,
      });

      let coverageStatus = connectorResult.status;
      let coverageStatusReason = connectorResult.statusReason;
      let coverageMessage = connectorResult.message;
      let validProcesses = [];

      if (connectorResult.status === "success") {
        validProcesses = sanitizeJudicialProcesses(tribunal, connectorResult.processes);
        if (validProcesses.length === 0) {
          coverageStatus = "not_found";
          coverageStatusReason = "parser_error";
          coverageMessage =
            "Resultado descartado por falta de evidência mínima (número do processo ausente).";
        }
      }

      let datajudEnrichment = {
        applied: false,
        attempted: 0,
        enriched: 0,
        unavailable: 0,
        failed: 0,
      };
      if (validProcesses.length > 0) {
        const enrichedResult = await enrichCrawlerProcessesWithDatajud(tribunal.tribunal_id, validProcesses);
        validProcesses = enrichedResult.processes;
        datajudEnrichment = enrichedResult.summary;
        if (datajudEnrichment.applied) {
          coverageMessage =
            `${coverageMessage ?? "Consulta concluída"} ` +
            `| Enriquecimento DataJud: ${datajudEnrichment.enriched}/${datajudEnrichment.attempted}`;
        }
      }

      const evidenceCount = validProcesses.length;
      await upsertInvestigationJudicialCoverage({
        runId: run.id,
        tribunalId: tribunal.tribunal_id,
        entityNodeId: rootNodeId,
        queryMode,
        status: coverageStatus,
        statusReason: coverageStatusReason,
        latencyMs: connectorResult.latencyMs,
        message: coverageMessage,
        connectorVersion: TRIBUNAL_CATALOG_VERSION,
        connectorFamily: connectorResult.connectorFamily ?? tribunal.connector_family,
        evidenceCount,
        metadata: {
          tribunal_nome: tribunal.nome,
          ramo: tribunal.ramo,
          attempts: connectorResult.attempts ?? [],
          connector_error_summary: connectorResult.errorSummary ?? "",
          datajud_enrichment: datajudEnrichment,
        },
      });

      if (coverageStatus === "unavailable" || coverageStatus === "error") {
        unavailableObserved = true;
        await appendInvestigationEvent({
          runId: run.id,
          level: "warn",
          agent: JUDICIAL_AGENT,
          message: "Tribunal indisponível na varredura judicial",
          payload: {
            tribunal_id: tribunal.tribunal_id,
            status_reason: coverageStatusReason,
            connector_family: connectorResult.connectorFamily ?? tribunal.connector_family,
            query_mode: queryMode,
          },
        });
      }

      if (validProcesses.length > 0) {
        foundProcesses += validProcesses.length;
        await insertInvestigationJudicialProcesses({
          runId: run.id,
          tribunalId: tribunal.tribunal_id,
          entityNodeId: rootNodeId,
          processes: validProcesses,
        });

        const classification = classifyJudicialSeverity(validProcesses);
        const findingId = buildFindingId({
          nodeId: rootNodeId,
          flagId: `judicial_${tribunal.tribunal_id}_${classification.type}`,
          sourceId: connectorResult.connectorFamily ?? tribunal.connector_family ?? "judicial",
          title: `Processos judiciais no ${tribunal.nome}`,
        });

        await insertInvestigationFinding({
          runId: run.id,
          findingId,
          entityNodeId: rootNodeId,
          flagId: `judicial_${tribunal.tribunal_id}_${classification.type}`,
          severity: classification.severity,
          title: `Processos judiciais encontrados em ${tribunal.nome}`,
          description:
            `Foram encontrados ${validProcesses.length} processo(s) no tribunal ${tribunal.nome} ` +
            `via conector ${connectorResult.connectorFamily ?? tribunal.connector_family}.`,
          weight: classification.weight,
          depth: 0,
          confidenceLevel: "CONFIRMADO",
          verificationStatus: "objective",
          sourceId: connectorResult.connectorFamily ?? tribunal.connector_family ?? "judicial",
          evidence: [
            { label: "Tribunal", value: tribunal.nome },
            { label: "Total de processos", value: String(validProcesses.length) },
            { label: "Método", value: queryMode },
            ...validProcesses
              .slice(0, 3)
              .map((process) => ({ label: "Número do processo", value: String(process.numeroProcesso) })),
          ],
        });
        break;
      }

      const hasNextMode = queryModes.indexOf(queryMode) < queryModes.length - 1;
      if (!hasNextMode) break;

      // Só tenta próximo modo se esse não foi conclusivo com match.
      if (coverageStatus === "not_found" || coverageStatus === "unavailable" || coverageStatus === "error") {
        continue;
      }
    }
  });

  const judicialSummary = await getInvestigationJudicialSummary(run.id).catch(() => null);
  await appendInvestigationEvent({
    runId: run.id,
    level: "info",
    agent: JUDICIAL_AGENT,
    message: "Varredura judicial nacional finalizada",
    payload: {
      tribunais_consultados: judicialSummary?.consulted ?? selectedTribunais.length,
      tribunais_indisponiveis: judicialSummary?.unavailable ?? 0,
      processos_encontrados: judicialSummary?.found_processes ?? foundProcesses,
    },
  });

  return { sourceErrors: unavailableObserved };
}

async function runNetworkAnalyzer(runId) {
  const graph = await getInvestigationGraph(runId);
  if (!graph) return;

  const outgoingSocioByPf = new Map();
  for (const edge of graph.edges) {
    if (edge.relationship !== "SOCIO_DE") continue;
    if (!String(edge.source_node_id).startsWith("PFH:") && !String(edge.source_node_id).startsWith("PFMASK:")) continue;
    outgoingSocioByPf.set(edge.source_node_id, (outgoingSocioByPf.get(edge.source_node_id) ?? 0) + 1);
  }

  for (const [pfNodeId, count] of outgoingSocioByPf.entries()) {
    if (count < 4) continue;
    const findingId = buildFindingId({
      nodeId: pfNodeId,
      flagId: "network_pf_multiplas_empresas",
      sourceId: "network",
      title: "Sócio com múltiplas empresas",
    });

    await insertInvestigationFinding({
      runId,
      findingId,
      entityNodeId: pfNodeId,
      flagId: "network_pf_multiplas_empresas",
      severity: "medium",
      title: "Sócio conectado a múltiplas empresas",
      description: `Sócio PF com ${count} empresas conectadas no grafo.`,
      weight: 10,
      depth: 1,
      confidenceLevel: "CONFIRMADO",
      verificationStatus: "objective",
      sourceId: "network",
      evidence: [{ label: "Empresas conectadas", value: String(count) }],
    });
  }

  if (outgoingSocioByPf.size > 0) {
    await appendInvestigationEvent({
      runId,
      level: "info",
      agent: NETWORK_AGENT,
      message: "Análise de padrões de rede concluída",
      payload: { pf_analyzed: outgoingSocioByPf.size },
    });
  }
}

async function processNode(run, node) {
  const entityType = classifyNodeFromId(node.node_id) === "UNKNOWN" ? node.entity_type : classifyNodeFromId(node.node_id);
  if (entityType === "PJ") return processPjNode(run, node);
  if (entityType === "PF") return processPfNode(run, node);

  await updateInvestigationNode(run.id, node.node_id, {
    status: "done",
    riskScore: 0,
    riskClassification: "Baixo",
    restrictionCount: 0,
  });
  return { sourceErrors: false };
}

async function refreshRunStats(runId, status = null, partial = false, errorText = null) {
  const stats = await getInvestigationStats(runId);
  if (!stats) return null;

  return updateInvestigationRun(runId, {
    ...(status ? { status } : {}),
    entities_discovered: stats.totalNodes,
    entities_processed: stats.processedNodes,
    depth_reached: stats.maxDepth,
    flags_count: stats.totalFindings,
    partial,
    ...(errorText ? { error_text: String(errorText).slice(0, 4000) } : {}),
  });
}

async function processRun(runId) {
  let run = await getInvestigationRun(runId);
  if (!run) return;

  await updateInvestigationRun(runId, { status: "running" });
  await appendInvestigationEvent({
    runId,
    level: "info",
    agent: ROOT_AGENT,
    message: "Investigação profunda iniciada",
    payload: {
      max_depth: run.max_depth,
      max_entities: run.max_entities,
      max_seconds: run.max_seconds,
      workers: NODE_CONCURRENCY,
    },
  });

  const startedAt = safeDate(run.started_at)?.getTime() ?? Date.now();
  let stopStatus = "completed";
  let sourceErrorsObserved = false;

  while (true) {
    run = await getInvestigationRun(runId);
    if (!run) break;
    if (run.status === "failed" || run.status === "completed" || run.status === "partial") break;

    const elapsedMs = Date.now() - startedAt;
    if (elapsedMs > Number(run.max_seconds) * 1000) {
      stopStatus = "budget_exceeded";
      break;
    }

    const stats = await getInvestigationStats(runId);
    if (stats && stats.totalNodes >= Number(run.max_entities) && stats.pendingNodes > 0) {
      stopStatus = "budget_exceeded";
      break;
    }

    const batch = await mapWithConcurrency(Array.from({ length: Math.max(1, NODE_CONCURRENCY) }), NODE_CONCURRENCY, async () =>
      dequeueInvestigationNode(runId),
    );
    const nodes = batch.filter(Boolean);
    if (nodes.length === 0) break;

    for (const node of nodes) {
      if (Number(node.depth ?? 0) > Number(run.max_depth)) {
        await updateInvestigationNode(runId, node.node_id, {
          status: "skipped",
          metadataJson: { reason: "max_depth_exceeded" },
        });
        continue;
      }

      try {
        const result = await processNode(run, node);
        sourceErrorsObserved = sourceErrorsObserved || Boolean(result?.sourceErrors);
      } catch (error) {
        await updateInvestigationNode(runId, node.node_id, {
          status: "error",
          metadataJson: {
            error: error instanceof Error ? error.message : "node_processing_failed",
          },
        });
        await appendInvestigationEvent({
          runId,
          level: "error",
          agent: ROOT_AGENT,
          message: `Falha ao processar nó ${node.node_id}`,
          payload: { error: error instanceof Error ? error.message : "unknown_error" },
        });
      }
    }

    await refreshRunStats(runId);
  }

  if (stopStatus !== "failed") {
    const judicialResult = await runJudicialCoverageAgent(run).catch((error) => {
      appendInvestigationEvent({
        runId,
        level: "error",
        agent: JUDICIAL_AGENT,
        message: "Falha no agente de cobertura judicial",
        payload: { error: error instanceof Error ? error.message : "unknown_error" },
      }).catch(() => {});
      return { sourceErrors: true };
    });
    sourceErrorsObserved = sourceErrorsObserved || Boolean(judicialResult?.sourceErrors);
  }

  await runNetworkAnalyzer(runId).catch(() => {});

  const finalStats = await getInvestigationStats(runId);
  if (stopStatus === "completed" && finalStats?.pendingNodes > 0) {
    stopStatus = "budget_exceeded";
  }

  const hasNodeErrors = (finalStats?.errorNodes ?? 0) > 0;
  const finalStatus = hasNodeErrors ? "partial" : stopStatus;
  const isPartial = hasNodeErrors || sourceErrorsObserved || finalStatus === "budget_exceeded";

  await updateInvestigationRun(runId, {
    status: finalStatus,
    finished_at: new Date(),
    entities_discovered: finalStats?.totalNodes ?? 0,
    entities_processed: finalStats?.processedNodes ?? 0,
    depth_reached: finalStats?.maxDepth ?? 0,
    flags_count: finalStats?.totalFindings ?? 0,
    partial: isPartial,
  });

  await appendInvestigationEvent({
    runId,
    level: "info",
    agent: ROOT_AGENT,
    message: "Investigação profunda finalizada",
    payload: {
      status: finalStatus,
      partial: isPartial,
      entities_discovered: finalStats?.totalNodes ?? 0,
      entities_processed: finalStats?.processedNodes ?? 0,
      depth_reached: finalStats?.maxDepth ?? 0,
      flags_count: finalStats?.totalFindings ?? 0,
    },
  });

  for (const key of sensitiveCpfCache.keys()) {
    if (key.startsWith(`${runId}:`)) sensitiveCpfCache.delete(key);
  }
  brazilioScanUsageByRun.delete(runId);
}

function startRunWorker(runId) {
  if (!runId) return;
  if (activeRuns.has(runId)) return;

  const promise = processRun(runId)
    .catch((error) => {
      console.error("[investigation] run failed:", runId, error?.message ?? error);
      return updateInvestigationRun(runId, {
        status: "failed",
        finished_at: new Date(),
        partial: true,
        error_text: error instanceof Error ? error.message : "unknown_failure",
      });
    })
    .finally(() => {
      activeRuns.delete(runId);
      brazilioScanUsageByRun.delete(runId);
    });
  activeRuns.set(runId, promise);
}

function toRootNodeFlags(flags) {
  return (Array.isArray(flags) ? flags : []).map((flag) => ({
    id: flag.id,
    source: flag.source ?? "Análise",
    source_id: flag.source_id ?? null,
    severity: flag.severity ?? "medium",
    title: flag.title ?? flag.id,
    description: flag.description ?? "",
    weight: Number(flag.weight ?? 0),
    depth: Number(flag.depth ?? 0),
    confidence_level: flag.confidence_level ?? null,
    confidence: flag.confidence ?? null,
    verification_status: normalizeVerificationStatus(flag),
    evidence: Array.isArray(flag.evidence) ? flag.evidence : [],
  }));
}

export async function enqueueDeepInvestigation(payload) {
  if (!isInvestigationStoreEnabled()) return null;

  const rootCnpj = cleanDocument(payload?.company?.cnpj ?? payload?.cnpj ?? "");
  if (rootCnpj.length !== 14) return null;

  const runId = crypto.randomUUID();
  const maxDepth = clampInt(DEFAULT_MAX_DEPTH, 1, Math.max(1, HARD_MAX_DEPTH));
  const maxEntities = clampInt(DEFAULT_MAX_ENTITIES, 10, Math.max(10, HARD_MAX_ENTITIES));
  const maxSeconds = clampInt(DEFAULT_MAX_SECONDS, 30, Math.max(30, HARD_MAX_SECONDS));

  const run = await createInvestigationRun({
    id: runId,
    rootCnpj,
    status: "queued",
    maxDepth,
    maxEntities,
    maxSeconds,
    sourcesVersion: payload?.sourcesVersion ?? null,
    snapshotAt: payload?.snapshotAt ?? null,
  });

  if (!run) return null;

  const rootNodeId = buildNodeIdForCnpj(rootCnpj);
  await enqueueInvestigationNode({
    runId,
    nodeId: rootNodeId,
    entityType: "PJ",
    displayName: payload?.company?.razao_social || rootCnpj,
    documentMasked: maskCnpj(rootCnpj),
    documentHash: sha256Hex(rootCnpj),
    depth: 0,
    sourceAgent: ROOT_AGENT,
    priority: 1,
    metadata: {
      cnpj: rootCnpj,
      uf: payload?.company?.uf ?? "",
      municipio: payload?.company?.municipio ?? "",
      capital_social: toNumber(payload?.company?.capital_social ?? 0),
      data_inicio_atividade: payload?.company?.data_inicio_atividade ?? "",
    },
  });

  const rootFlags = toRootNodeFlags(payload?.flags);
  await persistFindings(
    runId,
    {
      node_id: rootNodeId,
      depth: 0,
    },
    rootFlags,
  );

  await appendInvestigationEvent({
    runId,
    level: "info",
    agent: ROOT_AGENT,
    message: "Run enfileirado para investigação profunda automática",
    payload: {
      root_cnpj: rootCnpj,
      max_depth: maxDepth,
      max_entities: maxEntities,
      max_seconds: maxSeconds,
      relevance_threshold: DEFAULT_RELEVANCE_THRESHOLD,
    },
  });

  startRunWorker(runId);
  return {
    run_id: runId,
    status: "queued",
    auto_started: true,
  };
}

export async function getInvestigationStatus(runId) {
  const [summary, judicial] = await Promise.all([
    getInvestigationSummary(runId),
    getInvestigationJudicialSummary(runId),
  ]);
  if (!summary) return null;
  return {
    ...summary,
    judicial_scan: judicial ?? {
      supported: 0,
      consulted: 0,
      unavailable: 0,
      matched_tribunals: 0,
      found_processes: 0,
    },
  };
}

export async function getInvestigationGraphData(runId) {
  const graph = await getInvestigationGraph(runId);
  if (!graph) return null;

  const findingsByNode = new Map();
  for (const finding of graph.findings) {
    const list = findingsByNode.get(finding.entity_node_id) ?? [];
    list.push({
      id: finding.flag_id,
      finding_id: finding.finding_id,
      severity: finding.severity,
      title: finding.title,
      description: finding.description,
      weight: finding.weight,
      depth: finding.depth,
      confidence_level: finding.confidence_level,
      confidence: finding.confidence,
      verification_status: finding.verification_status,
      source_id: finding.source_id,
      evidence: finding.evidence_json,
      created_at: finding.created_at,
    });
    findingsByNode.set(finding.entity_node_id, list);
  }

  const nodes = graph.nodes.map((node) => ({
    id: node.node_id,
    entity_type: node.entity_type,
    label: node.display_name,
    depth: node.depth,
    document_masked: node.document_masked,
    document_hash: node.document_hash,
    risk_score: node.risk_score,
    risk_classification: node.risk_classification || toSeverityClass(node.risk_score ?? 0),
    restriction_count: node.restriction_count ?? node.finding_count ?? 0,
    status: node.status,
    metadata: node.metadata_json ?? {},
    findings: findingsByNode.get(node.node_id) ?? [],
  }));

  const edges = graph.edges.map((edge) => ({
    id: edge.edge_id,
    source_id: edge.source_node_id,
    target_id: edge.target_node_id,
    relationship: edge.relationship,
    obligation_code: edge.obligation_code,
    obligation_label: edge.obligation_label,
    confidence: edge.confidence,
    source_base: edge.source_base,
    metadata: edge.metadata_json ?? {},
  }));

  return { nodes, edges };
}

export async function getInvestigationEventsFeed(runId, cursor = 0) {
  const rows = await getInvestigationEvents(runId, cursor, 200);
  const events = rows.map((row) => ({
    seq: Number(row.id),
    level: row.level,
    agent: row.agent,
    message: row.message,
    payload: row.payload_json ?? {},
    created_at: row.created_at,
  }));
  const nextCursor = events.length > 0 ? Number(events[events.length - 1].seq) : Number(cursor);
  return { cursor: nextCursor, events };
}

export async function getInvestigationJudicialCoverageData(runId) {
  const [summary, rows] = await Promise.all([
    getInvestigationJudicialSummary(runId),
    getInvestigationJudicialCoverage(runId),
  ]);

  return {
    summary: summary ?? {
      supported: 0,
      consulted: 0,
      unavailable: 0,
      matched_tribunals: 0,
      found_processes: 0,
    },
    items: rows.map((row) => ({
      tribunal_id: row.tribunal_id,
      tribunal_name: row.nome ?? row.tribunal_id,
      ramo: row.ramo ?? "desconhecido",
      uf_scope: row.uf_scope ?? "",
      query_mode: row.query_mode,
      status: row.status,
      status_reason: row.status_reason,
      latency_ms: row.latency_ms,
      message: row.message,
      connector_family: row.connector_family ?? "unknown",
      connector_version: row.connector_version,
      evidence_count: row.evidence_count ?? 0,
      attempted_at: row.attempted_at,
      metadata: row.metadata_json ?? {},
    })),
  };
}

export async function getInvestigationJudicialProcessesData(runId) {
  const rows = await getInvestigationJudicialProcesses(runId);
  return {
    total: rows.length,
    items: rows.map((row) => ({
      tribunal_id: row.tribunal_id,
      tribunal_name: row.nome ?? row.tribunal_id,
      ramo: row.ramo ?? "desconhecido",
      uf_scope: row.uf_scope ?? "",
      entity_node_id: row.entity_node_id,
      process_key: row.process_key,
      numero_processo: row.numero_processo,
      classe: row.classe,
      assunto: row.assunto,
      orgao_julgador: row.orgao_julgador,
      data_ajuizamento: row.data_ajuizamento,
      valor_causa: row.valor_causa,
      polo_empresa: row.polo_empresa,
      parte_contraria: row.parte_contraria_json ?? [],
      andamentos: row.andamentos_json ?? [],
      source_url: row.source_url,
      evidence: row.evidence_json ?? [],
      created_at: row.created_at,
    })),
  };
}

export async function getInvestigationJudicialSummaryData(runId) {
  const summary = await getInvestigationJudicialSummary(runId);
  return summary ?? {
    supported: 0,
    consulted: 0,
    unavailable: 0,
    matched_tribunals: 0,
    found_processes: 0,
  };
}

export async function recoverAndResumeInvestigations() {
  const recovered = await recoverStaleInvestigationRuns().catch(() => 0);
  const candidates = await listRecoverableInvestigationRuns(50).catch(() => []);
  for (const run of candidates) {
    startRunWorker(run.id);
  }
  return { recovered, resumed: candidates.length };
}
