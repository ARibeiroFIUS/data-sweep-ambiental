/**
 * DataJud — Consulta de Processos Judiciais (CNJ)
 *
 * API Pública do DataJud: https://datajud-wiki.cnj.jus.br/api-publica
 * Chave pública disponibilizada pelo CNJ em: https://datajud-wiki.cnj.jus.br/api-publica/acesso
 *
 * Estratégia: dado o CNPJ + UF da empresa, seleciona os tribunais mais
 * relevantes (TJ do estado, TRF da região, TRT da região + STJ) e faz
 * buscas em paralelo pela parte processual.
 */

import { cleanDocument, mapWithConcurrency, normalizePersonName } from "./common-utils.mjs";
import { fetchWithTimeout } from "./http-utils.mjs";
import { isSourceEnabled } from "./source-registry.mjs";

const DATAJUD_BASE_URL = "https://api-publica.datajud.cnj.jus.br";

// Chave pública divulgada pelo CNJ no wiki oficial. Pode ser sobrescrita via env.
const DATAJUD_API_KEY =
  (process.env.DATAJUD_API_KEY ?? "").trim() ||
  "cDZHYzlZa0JadVREZDJCendQbXY6SkJlTzNjLV9TRENyQk1RdnFKZGRQdw==";

const DATAJUD_TIMEOUT_MS = Number.parseInt(process.env.DATAJUD_TIMEOUT_MS ?? "8000", 10);
const DATAJUD_PER_TRIBUNAL = Number.parseInt(process.env.DATAJUD_PER_TRIBUNAL ?? "20", 10);
const DATAJUD_CONCURRENCY = 5;
const DATAJUD_CAPS_TIMEOUT_MS = Number.parseInt(process.env.DATAJUD_CAPS_TIMEOUT_MS ?? "4000", 10);
const DATAJUD_CAPS_TTL_MS = Number.parseInt(process.env.DATAJUD_CAPS_TTL_MS ?? `${24 * 60 * 60 * 1000}`, 10);

const SUPERIOR_TRIBUNAIS = ["stj", "tst", "tse", "stm"];

// ─────────────────────────────────────────────────────────────────────────────
// Mapeamento UF → tribunais relevantes
// ─────────────────────────────────────────────────────────────────────────────

const UF_TO_TJ = {
  AC: "tjac", AL: "tjal", AM: "tjam", AP: "tjap", BA: "tjba",
  CE: "tjce", DF: "tjdft", ES: "tjes", GO: "tjgo", MA: "tjma",
  MG: "tjmg", MS: "tjms", MT: "tjmt", PA: "tjpa", PB: "tjpb",
  PE: "tjpe", PI: "tjpi", PR: "tjpr", RJ: "tjrj", RN: "tjrn",
  RO: "tjro", RR: "tjrr", RS: "tjrs", SC: "tjsc", SE: "tjse",
  SP: "tjsp", TO: "tjto",
};

// TRF por UF (região da Justiça Federal)
const UF_TO_TRF = {
  AC: "trf1", AL: "trf5", AM: "trf1", AP: "trf1", BA: "trf1",
  CE: "trf5", DF: "trf1", ES: "trf2", GO: "trf1", MA: "trf1",
  MG: "trf6", MS: "trf3", MT: "trf1", PA: "trf1", PB: "trf5",
  PE: "trf5", PI: "trf1", PR: "trf4", RJ: "trf2", RN: "trf5",
  RO: "trf1", RR: "trf1", RS: "trf4", SC: "trf4", SE: "trf5",
  SP: "trf3", TO: "trf1",
};

// TRT por UF (Justiça do Trabalho)
const UF_TO_TRT = {
  AC: ["trt14"], AL: ["trt19"], AM: ["trt11"], AP: ["trt8"], BA: ["trt5"],
  CE: ["trt7"], DF: ["trt10"], ES: ["trt17"], GO: ["trt18"], MA: ["trt16"],
  MG: ["trt3"], MS: ["trt24"], MT: ["trt23"], PA: ["trt8"], PB: ["trt13"],
  PE: ["trt6"], PI: ["trt22"], PR: ["trt9"], RJ: ["trt1"], RN: ["trt21"],
  RO: ["trt14"], RR: ["trt11"], RS: ["trt4"], SC: ["trt12"], SE: ["trt20"],
  SP: ["trt2", "trt15"], TO: ["trt10"],
};

/** @type {Map<string, { checkedAt: number, fields: string[], supportsEntityLookup: boolean }>} */
const tribunalCapsCache = new Map();

// ─────────────────────────────────────────────────────────────────────────────
// Classificação de processos por risco
// ─────────────────────────────────────────────────────────────────────────────

const CRIMINAL_KEYWORDS = /criminal|penal|improbidade|fraude|corrupção|estelionato|lavagem/i;
const FISCAL_KEYWORDS = /execução fiscal|dívida ativa|fazenda|tributária|tributário/i;
const LABOR_KEYWORDS = /trabalhista|reclamação|rescisão|trabalho|trt|empregado|FGTS|verbas/i;
const CIVIL_KEYWORDS = /indenização|cobrança|monitória|despejo|contrato|civil/i;
const FALENCIA_KEYWORDS = /falência|falencia|insolvência|insolvencia|concordata/i;
const RECUPERACAO_KEYWORDS = /recuperação judicial|recuperacao judicial|reestruturação/i;

// Códigos de classe CNJ para falência e recuperação judicial (tabelas CNJ oficiais)
const FALENCIA_CLASS_CODES = new Set([1111, 1113, 2687, 1116]);
const RECUPERACAO_CLASS_CODES = new Set([1112, 1114, 2685, 2686, 1115]);

function classifyProcesso(processo) {
  const classeNome = processo.classe?.nome ?? "";
  const classeCodigo = Number(processo.classe?.codigo ?? 0);
  const text = [
    classeNome,
    ...(Array.isArray(processo.assuntos) ? processo.assuntos.map((a) => a.nome ?? "") : []),
  ].join(" ");

  // Falência e recuperação judicial têm prioridade máxima — sinais de insolvência
  if (FALENCIA_CLASS_CODES.has(classeCodigo) || FALENCIA_KEYWORDS.test(text)) return "falencia";
  if (RECUPERACAO_CLASS_CODES.has(classeCodigo) || RECUPERACAO_KEYWORDS.test(text)) return "recuperacao";

  if (CRIMINAL_KEYWORDS.test(text)) return "criminal";
  if (FISCAL_KEYWORDS.test(text)) return "fiscal";
  if (LABOR_KEYWORDS.test(text) || String(processo.tribunal ?? "").toLowerCase().startsWith("trt")) return "trabalhista";
  if (CIVIL_KEYWORDS.test(text)) return "civil";
  return "outro";
}

// ─────────────────────────────────────────────────────────────────────────────
// Seleção de tribunais pela UF
// ─────────────────────────────────────────────────────────────────────────────

function selectTribunais(uf) {
  const normalized = (uf ?? "").toUpperCase().trim();
  const set = new Set(SUPERIOR_TRIBUNAIS);

  const tj = UF_TO_TJ[normalized];
  const trf = UF_TO_TRF[normalized];
  const trt = UF_TO_TRT[normalized];

  if (tj) set.add(tj);
  if (trf) set.add(trf);
  if (Array.isArray(trt)) {
    for (const item of trt) set.add(item);
  } else if (trt) {
    set.add(trt);
  }

  // Se UF desconhecida, cobre os maiores tribunais
  if (!tj) {
    set.add("tjsp");
    set.add("trf3");
    set.add("trt2");
    set.add("trt15");
  }

  return Array.from(set);
}

function capsSupportEntityLookup(fields) {
  return fields.some((field) =>
    field.startsWith("partes") ||
    field.startsWith("poloAtivo") ||
    field.startsWith("poloPassivo") ||
    field.includes("documento") ||
    field.includes("cpf") ||
    field.includes("cnpj"),
  );
}

export async function getDatajudTribunalFieldCaps(tribunal, timeoutMs = DATAJUD_CAPS_TIMEOUT_MS) {
  const cached = tribunalCapsCache.get(tribunal);
  if (cached && Date.now() - cached.checkedAt < DATAJUD_CAPS_TTL_MS) {
    return cached;
  }

  const url = `${DATAJUD_BASE_URL}/api_publica_${tribunal}/_field_caps?fields=partes.*,poloAtivo.*,poloPassivo.*,classe.nome,assuntos.nome,movimentos.nome,numeroProcesso`;
  const response = await fetchWithTimeout(url, timeoutMs, {
    headers: { Authorization: `APIKey ${DATAJUD_API_KEY}` },
  });

  if (!response || !response.ok) {
    const fallback = { checkedAt: Date.now(), fields: [], supportsEntityLookup: false };
    tribunalCapsCache.set(tribunal, fallback);
    return fallback;
  }

  const payload = await response.json().catch(() => null);
  const fields = Object.keys(payload?.fields ?? {});
  const caps = {
    checkedAt: Date.now(),
    fields,
    supportsEntityLookup: capsSupportEntityLookup(fields),
  };
  tribunalCapsCache.set(tribunal, caps);
  return caps;
}

function buildSearchBody(cnpj) {
  return {
    size: DATAJUD_PER_TRIBUNAL,
    query: {
      bool: {
        should: [
          { term: { "partes.documento": cnpj } },
          { term: { "partes.documento.keyword": cnpj } },
          { term: { "poloAtivo.documento": cnpj } },
          { term: { "poloPassivo.documento": cnpj } },
          { query_string: { query: `"${cnpj}"` } },
        ],
        minimum_should_match: 1,
      },
    },
    _source: ["numeroProcesso", "classe", "assuntos", "dataAjuizamento", "orgaoJulgador", "partes", "valor", "grau", "movimentos"],
    sort: [{ dataAjuizamento: { order: "desc" } }],
  };
}

function buildSearchBodyByName(name) {
  const safeName = String(name ?? "").trim();
  return {
    size: DATAJUD_PER_TRIBUNAL,
    query: {
      bool: {
        should: [
          { match_phrase: { "partes.nome": safeName } },
          { match_phrase: { "poloAtivo.nome": safeName } },
          { match_phrase: { "poloPassivo.nome": safeName } },
          { query_string: { query: `"${safeName}"` } },
        ],
        minimum_should_match: 1,
      },
    },
    _source: ["numeroProcesso", "classe", "assuntos", "dataAjuizamento", "orgaoJulgador", "partes", "valor", "grau", "movimentos"],
    sort: [{ dataAjuizamento: { order: "desc" } }],
  };
}

function buildSearchBodyByProcessNumber(processNumber) {
  const value = String(processNumber ?? "").trim();
  return {
    size: 3,
    query: {
      bool: {
        should: [
          { term: { "numeroProcesso.keyword": value } },
          { term: { numeroProcesso: value } },
          { match_phrase: { numeroProcesso: value } },
          { query_string: { query: `"${value}"` } },
        ],
        minimum_should_match: 1,
      },
    },
    _source: [
      "numeroProcesso",
      "classe",
      "assuntos",
      "dataAjuizamento",
      "orgaoJulgador",
      "valor",
      "valorCausa",
      "grau",
      "movimentos",
    ],
    sort: [{ dataAjuizamento: { order: "desc" } }],
  };
}

function nameOverlap(targetNormalized, candidateName) {
  const normalizedCandidate = normalizePersonName(candidateName ?? "");
  if (!targetNormalized || !normalizedCandidate) return false;
  if (normalizedCandidate.includes(targetNormalized) || targetNormalized.includes(normalizedCandidate)) {
    return true;
  }
  const targetTokens = targetNormalized.split(" ").filter((token) => token.length > 2);
  const candidateTokens = new Set(normalizedCandidate.split(" ").filter((token) => token.length > 2));
  const overlap = targetTokens.filter((token) => candidateTokens.has(token)).length;
  return overlap >= 2;
}

function classifyTribunalError(payload, statusCode) {
  if (statusCode === 401 || statusCode === 403) return "unauthorized";
  if (statusCode === 429) return "rate_limited";

  const reason =
    payload?.error?.root_cause?.[0]?.reason ??
    payload?.error?.reason ??
    payload?.message ??
    "";

  if (String(reason).toLowerCase().includes("failed to find nested object under path")) {
    return "field_not_available";
  }

  if (statusCode >= 500) return "upstream_5xx";
  if (statusCode >= 400) return `upstream_${statusCode}`;
  return "unknown_error";
}

// ─────────────────────────────────────────────────────────────────────────────
// Query a um único tribunal (POST Elasticsearch)
// ─────────────────────────────────────────────────────────────────────────────

async function queryOneTribunalRaw({ tribunal, timeoutMs, body, rootCnpj = "", normalizedTargetName = "" }) {
  const url = `${DATAJUD_BASE_URL}/api_publica_${tribunal}/_search`;
  const payloadBody = JSON.stringify(body);

  try {
    const res = await fetchWithTimeout(url, timeoutMs, {
      method: "POST",
      headers: {
        Authorization: `APIKey ${DATAJUD_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: payloadBody,
    });

    if (!res) {
      return { tribunal, ok: false, processes: [], error: "timeout" };
    }

    const payload = await res.json().catch(() => null);
    if (!res.ok) {
      return {
        tribunal,
        ok: false,
        processes: [],
        error: classifyTribunalError(payload, res.status),
      };
    }

    const hits = payload?.hits?.hits ?? [];

    return {
      tribunal,
      ok: true,
      processes: hits
        .map((hit) => {
        const src = hit._source ?? {};
        const partes = Array.isArray(src.partes) ? src.partes : [];
        const partesAtivas = partes.filter((p) => String(p.polo ?? "").toUpperCase() === "ATIVO");
        const partesPassivas = partes.filter((p) => String(p.polo ?? "").toUpperCase() === "PASSIVO");
        let empresaEhAutora = false;

        if (rootCnpj) {
          empresaEhAutora = partesAtivas.some((p) => cleanDocument(p.documento ?? "").startsWith(rootCnpj));
        } else if (normalizedTargetName) {
          const matchAtivo = partesAtivas.some((p) => nameOverlap(normalizedTargetName, p.nome));
          const matchPassivo = partesPassivas.some((p) => nameOverlap(normalizedTargetName, p.nome));
          if (matchAtivo && !matchPassivo) empresaEhAutora = true;
          if (!matchAtivo && matchPassivo) empresaEhAutora = false;
          if (!matchAtivo && !matchPassivo) return null;
          if (matchAtivo && matchPassivo) empresaEhAutora = false;
        }

        const parteContraria = empresaEhAutora
          ? partesPassivas.map((p) => p.nome).filter(Boolean).slice(0, 3)
          : partesAtivas.map((p) => p.nome).filter(Boolean).slice(0, 3);

        const movimentos = Array.isArray(src.movimentos) ? src.movimentos : [];
        const andamentos = movimentos
          .slice()
          .sort((a, b) => new Date(b.dataHora ?? 0).getTime() - new Date(a.dataHora ?? 0).getTime())
          .slice(0, 5)
          .map((m) => ({
            dataHora: m.dataHora ?? null,
            nome: m.nome ?? "",
            complemento: m.complemento ?? null,
          }));

        return {
          tribunal,
          numeroProcesso: src.numeroProcesso ?? "",
          classe: src.classe ?? null,
          assuntos: src.assuntos ?? [],
          dataAjuizamento: src.dataAjuizamento ?? null,
          ano: src.dataAjuizamento ? String(src.dataAjuizamento).slice(0, 4) : null,
          orgaoJulgador: src.orgaoJulgador ?? null,
          valor: src.valor ?? src.valorCausa ?? src.valorDaCausa ?? null,
          grau: src.grau ?? null,
          polo: empresaEhAutora ? "ATIVO" : "PASSIVO",
          parteContraria,
          andamentos,
        };
      })
        .filter(Boolean),
      error: null,
    };
  } catch {
    return { tribunal, ok: false, processes: [], error: "request_failed" };
  }
}

async function queryOneTribunalByCnpj(cnpj, tribunal, timeoutMs) {
  const rootCnpj = cleanDocument(cnpj).slice(0, 8);
  return queryOneTribunalRaw({
    tribunal,
    timeoutMs,
    body: buildSearchBody(cnpj),
    rootCnpj,
  });
}

async function queryOneTribunalByName(name, tribunal, timeoutMs) {
  const normalizedTargetName = normalizePersonName(name);
  return queryOneTribunalRaw({
    tribunal,
    timeoutMs,
    body: buildSearchBodyByName(name),
    normalizedTargetName,
  });
}

async function queryOneTribunalByProcessNumber(processNumber, tribunal, timeoutMs) {
  const result = await queryOneTribunalRaw({
    tribunal,
    timeoutMs,
    body: buildSearchBodyByProcessNumber(processNumber),
  });

  if (!result.ok) return result;

  const mapped = (result.processes ?? []).map((item) => ({
    ...item,
    polo: null,
    parteContraria: Array.isArray(item.parteContraria) ? item.parteContraria : [],
  }));

  return { ...result, processes: mapped };
}

function mapDatajudTribunalErrorToStatusReason(error) {
  const reason = String(error ?? "");
  if (!reason) return "unknown_error";
  if (reason === "timeout") return "timeout_or_network";
  if (reason === "unauthorized") return "unauthorized";
  if (reason === "rate_limited") return "rate_limited";
  if (reason === "field_not_available") return "parser_error";
  if (reason.startsWith("upstream_")) return reason;
  return "request_failed";
}

/**
 * Consulta um tribunal específico na API pública do DataJud.
 * @param {{ tribunalId: string, cnpj?: string, name?: string, queryMode?: string, timeoutMs?: number }} input
 */
export async function queryDatajudTribunal(input) {
  const tribunalId = String(input?.tribunalId ?? "").trim().toLowerCase();
  const cleanCnpj = cleanDocument(input?.cnpj ?? "");
  const cleanName = String(input?.name ?? "").trim();
  const processNumber = String(input?.processNumber ?? "").trim();
  const queryMode = String(input?.queryMode ?? "cnpj_exact").trim();
  const timeoutMs = Number.isFinite(Number(input?.timeoutMs))
    ? Number(input.timeoutMs)
    : DATAJUD_TIMEOUT_MS;

  const startedAt = Date.now();
  if (!isDatajudEnabled()) {
    return {
      status: "unavailable",
      statusReason: "feature_disabled",
      latencyMs: Date.now() - startedAt,
      processes: [],
      message: "DataJud desabilitado por feature flag",
    };
  }

  if (!tribunalId) {
    return {
      status: "unavailable",
      statusReason: "invalid_tribunal",
      latencyMs: Date.now() - startedAt,
      processes: [],
      message: "Tribunal inválido para consulta DataJud",
    };
  }

  if (queryMode !== "cnpj_exact" && queryMode !== "party_name" && queryMode !== "process_number") {
    return {
      status: "unavailable",
      statusReason: "unsupported_query_mode",
      latencyMs: Date.now() - startedAt,
      processes: [],
      message: `Query mode ${queryMode} não suportado no conector DataJud`,
    };
  }

  if (queryMode === "cnpj_exact" && cleanCnpj.length !== 14) {
    return {
      status: "invalid",
      statusReason: "invalid_cnpj",
      latencyMs: Date.now() - startedAt,
      processes: [],
      message: "CNPJ inválido",
    };
  }

  if (queryMode === "party_name" && normalizePersonName(cleanName).split(" ").filter(Boolean).length < 2) {
    return {
      status: "invalid",
      statusReason: "invalid_party_name",
      latencyMs: Date.now() - startedAt,
      processes: [],
      message: "Nome da parte insuficiente para consulta confiável no DataJud",
    };
  }

  if (queryMode === "process_number" && processNumber.length < 10) {
    return {
      status: "invalid",
      statusReason: "invalid_process_number",
      latencyMs: Date.now() - startedAt,
      processes: [],
      message: "Número de processo inválido para consulta DataJud",
    };
  }

  if (queryMode === "cnpj_exact" || queryMode === "party_name") {
    const caps = await getDatajudTribunalFieldCaps(tribunalId, DATAJUD_CAPS_TIMEOUT_MS);
    if (!caps.supportsEntityLookup) {
      return {
        status: "unavailable",
        statusReason: "entity_lookup_not_supported_public_api",
        latencyMs: Date.now() - startedAt,
        processes: [],
        message:
          "A API pública do DataJud não expõe campos de partes/documentos para este tribunal.",
        errorSummary: Array.isArray(caps.fields) ? caps.fields.slice(0, 8).join(", ") : "",
      };
    }
  }

  const result =
    queryMode === "cnpj_exact"
      ? await queryOneTribunalByCnpj(cleanCnpj, tribunalId, timeoutMs)
      : queryMode === "party_name"
        ? await queryOneTribunalByName(cleanName, tribunalId, timeoutMs)
        : await queryOneTribunalByProcessNumber(processNumber, tribunalId, timeoutMs);
  if (!result.ok) {
    return {
      status: "unavailable",
      statusReason: mapDatajudTribunalErrorToStatusReason(result.error),
      latencyMs: Date.now() - startedAt,
      processes: [],
      message: `Falha na consulta DataJud para ${tribunalId}`,
      errorSummary: result.error ?? "request_failed",
    };
  }

  return {
    status: result.processes.length > 0 ? "success" : "not_found",
    statusReason: result.processes.length > 0 ? "match_found" : "not_listed",
    latencyMs: Date.now() - startedAt,
    processes: result.processes,
    message: undefined,
    errorSummary: "",
  };
}

function summarizeTribunalErrors(errors) {
  if (!Array.isArray(errors) || errors.length === 0) return "";
  const byReason = new Map();
  for (const item of errors) {
    const key = String(item?.reason ?? "unknown_error");
    byReason.set(key, (byReason.get(key) ?? 0) + 1);
  }

  return Array.from(byReason.entries())
    .map(([reason, count]) => `${reason}:${count}`)
    .join(", ");
}

function emptyByType() {
  return { criminal: [], fiscal: [], trabalhista: [], civil: [], falencia: [], recuperacao: [], outro: [] };
}

function classifyOverallStatus(processes, successfulTribunais, tribunalErrors) {
  if (processes.length > 0) {
    return { status: "success", statusReason: "match_found" };
  }

  if (successfulTribunais === 0 && tribunalErrors.length > 0) {
    return { status: "unavailable", statusReason: "no_tribunal_response" };
  }

  if (successfulTribunais > 0 && tribunalErrors.length > 0) {
    return { status: "not_found", statusReason: "partial_coverage_no_match" };
  }

  return { status: "not_found", statusReason: "not_listed" };
}

// ─────────────────────────────────────────────────────────────────────────────
// API pública do módulo
// ─────────────────────────────────────────────────────────────────────────────

export function isDatajudEnabled() {
  return isSourceEnabled("datajud");
}

/**
 * Consulta processos judiciais para um CNPJ em múltiplos tribunais.
 *
 * @param {string} cnpj - CNPJ limpo (14 dígitos)
 * @param {{ uf?: string }} options
 * @returns {Promise<{ status: string, processes: Array, byType: object, total: number }>}
 */
export async function queryProcessosByCnpj(cnpj, { uf = "" } = {}) {
  const cleanCnpj = cleanDocument(cnpj);
  if (cleanCnpj.length !== 14) {
    return {
      status: "invalid",
      statusReason: "invalid_cnpj",
      processes: [],
      byType: emptyByType(),
      total: 0,
      tribunaisConsultados: [],
      tribunaisSucesso: [],
      tribunalErrors: [],
      errorSummary: "",
    };
  }

  if (!isDatajudEnabled()) {
    return {
      status: "unavailable",
      statusReason: "feature_disabled",
      processes: [],
      byType: emptyByType(),
      total: 0,
      tribunaisConsultados: [],
      tribunaisSucesso: [],
      tribunalErrors: [],
      errorSummary: "",
    };
  }

  const tribunais = selectTribunais(uf);
  const tribunalCaps = await mapWithConcurrency(tribunais, 4, (tribunal) =>
    getDatajudTribunalFieldCaps(tribunal, DATAJUD_CAPS_TIMEOUT_MS),
  );

  const tribunaisComLookupEntidade = tribunais.filter((_, idx) => tribunalCaps[idx]?.supportsEntityLookup);
  if (tribunaisComLookupEntidade.length === 0) {
    const fieldsSummary = Array.from(new Set(tribunalCaps.flatMap((caps) => caps?.fields ?? [])))
      .slice(0, 10)
      .join(", ");
    return {
      status: "unavailable",
      statusReason: "entity_lookup_not_supported_public_api",
      message:
        "A API pública do DataJud não expõe campos de partes/documentos (CPF/CNPJ), " +
        "então a busca confiável por empresa não é suportada neste endpoint.",
      processes: [],
      byType: emptyByType(),
      total: 0,
      tribunaisConsultados: tribunais,
      tribunaisSucesso: [],
      tribunalErrors: [],
      errorSummary: fieldsSummary ? `campos_disponiveis:${fieldsSummary}` : "",
    };
  }

  const results = await mapWithConcurrency(tribunaisComLookupEntidade, DATAJUD_CONCURRENCY, (tribunal) =>
    queryOneTribunalByCnpj(cleanCnpj, tribunal, DATAJUD_TIMEOUT_MS),
  );

  const processes = [];
  const tribunalErrors = [];
  const tribunaisSucesso = [];

  for (const result of results) {
    if (result?.ok) {
      tribunaisSucesso.push(result.tribunal);
      processes.push(...(result.processes ?? []));
      continue;
    }

    tribunalErrors.push({
      tribunal: result?.tribunal ?? "unknown",
      reason: result?.error ?? "unknown_error",
    });
  }

  // Agrupar por tipo para facilitar a geração de flags
  const byType = emptyByType();
  for (const p of processes) {
    const type = classifyProcesso(p);
    byType[type].push(p);
  }

  const summary = classifyOverallStatus(processes, tribunaisSucesso.length, tribunalErrors);

  return {
    status: summary.status,
    statusReason: summary.statusReason,
    processes,
    byType,
    total: processes.length,
    tribunaisConsultados: tribunaisComLookupEntidade,
    tribunaisSucesso,
    tribunalErrors,
    errorSummary: summarizeTribunalErrors(tribunalErrors),
  };
}
