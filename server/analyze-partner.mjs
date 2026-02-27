import { cleanDocument, normalizePersonName, parseDelimitedLine, resolveHeaderIndexAny } from "./common-utils.mjs";
import { fetchWithTimeout } from "./http-utils.mjs";
import { lookupCompaniesByCpf } from "./bigquery-reverse-lookup.mjs";
import { buildCpfMaskedFromFull, lookupCompaniesByMaskedProfile } from "./brasilio-reverse-lookup.mjs";
import { calculateScore } from "./risk-scoring.mjs";
import { getSourceConfig, isSourceEnabled, SOURCES_VERSION } from "./source-registry.mjs";

const PORTAL_TRANSPARENCIA_API_KEY = (process.env.PORTAL_TRANSPARENCIA_API_KEY ?? "").trim();
const TCU_ELEITORAL_URL =
  "https://sites.tcu.gov.br/dados-abertos/inidoneos-irregulares/arquivos/resp-contas-julgadas-irreg-implicacao-eleitoral.csv";

/** @type {{ fetchedAt: number, cpfs: Set<string> } | null} */
let tcuEleitoralCache = null;

export class PartnerHttpError extends Error {
  /**
   * @param {number} statusCode
   * @param {string} message
   */
  constructor(statusCode, message) {
    super(message);
    this.name = "PartnerHttpError";
    this.statusCode = statusCode;
  }
}

function normalizeCnpj(value) {
  return cleanDocument(value).slice(0, 14);
}

function normalizeCpf(value) {
  return cleanDocument(value).slice(0, 11);
}

function isValidCpf(cpf) {
  if (!/^\d{11}$/.test(cpf)) return false;
  if (/^(\d)\1{10}$/.test(cpf)) return false;

  function calcDigit(base, factor) {
    let total = 0;
    for (let i = 0; i < base.length; i += 1) {
      total += Number(base[i]) * (factor - i);
    }
    const mod = total % 11;
    return mod < 2 ? 0 : 11 - mod;
  }

  const firstDigit = calcDigit(cpf.slice(0, 9), 10);
  const secondDigit = calcDigit(cpf.slice(0, 10), 11);
  return cpf.endsWith(`${firstDigit}${secondDigit}`);
}

function sourceName(sourceId) {
  try {
    return getSourceConfig(sourceId).name;
  } catch {
    return sourceId;
  }
}

function buildSourceStatus(sourceId, status, data = {}) {
  return {
    id: sourceId,
    name: sourceName(sourceId),
    status,
    latency_ms: Number(data.latencyMs ?? 0),
    evidence_count: Number(data.evidenceCount ?? 0),
    ...(data.statusReason ? { status_reason: data.statusReason } : {}),
    ...(data.message ? { message: data.message } : {}),
  };
}

async function fetchCompanyByCnpj(cnpj) {
  const sourceId = "receita_brasilapi";
  const start = Date.now();

  if (!isSourceEnabled(sourceId)) {
    return {
      company: null,
      source: buildSourceStatus(sourceId, "unavailable", {
        latencyMs: Date.now() - start,
        statusReason: "feature_disabled",
      }),
    };
  }

  const timeoutMs = getSourceConfig(sourceId).timeoutMs;
  const response = await fetchWithTimeout(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, timeoutMs);
  if (!response) {
    return {
      company: null,
      source: buildSourceStatus(sourceId, "unavailable", {
        latencyMs: Date.now() - start,
        statusReason: "timeout_or_network",
      }),
    };
  }
  if (response.status === 404) {
    return {
      company: null,
      source: buildSourceStatus(sourceId, "not_found", {
        latencyMs: Date.now() - start,
        statusReason: "not_found",
      }),
    };
  }
  if (!response.ok) {
    return {
      company: null,
      source: buildSourceStatus(sourceId, "error", {
        latencyMs: Date.now() - start,
        statusReason: `http_${response.status}`,
      }),
    };
  }

  const payload = await response.json().catch(() => null);
  if (!payload || typeof payload !== "object") {
    return {
      company: null,
      source: buildSourceStatus(sourceId, "error", {
        latencyMs: Date.now() - start,
        statusReason: "invalid_json",
      }),
    };
  }

  return {
    company: payload,
    source: buildSourceStatus(sourceId, "success", {
      latencyMs: Date.now() - start,
      statusReason: "ok",
      evidenceCount: 1,
    }),
  };
}

function toPfPartnerEntries(company) {
  const qsa = Array.isArray(company?.qsa) ? company.qsa : [];
  return qsa
    .map((entry) => ({
      tipo: entry?.identificador_de_socio === 1 ? "PJ" : "PF",
      nome: String(entry?.nome_socio ?? entry?.nome ?? "").trim(),
      qual: String(entry?.qualificacao_socio ?? entry?.qual ?? "").trim(),
      documento_raw: String(entry?.cnpj_cpf_do_socio ?? "").trim(),
      documento_clean: cleanDocument(entry?.cnpj_cpf_do_socio ?? ""),
      nome_norm: normalizePersonName(entry?.nome_socio ?? entry?.nome ?? ""),
    }))
    .filter((entry) => entry.tipo === "PF");
}

function resolvePartnerOwnership(pfPartners, cpf, nome) {
  const cpfCore = cpf.slice(3, 9);
  const nomeNorm = normalizePersonName(nome);

  const byCpf = pfPartners.find((entry) => entry.documento_clean.length === 11 && entry.documento_clean === cpf);
  if (byCpf) {
    return { ok: true, mode: "cpf_exact", partner: byCpf };
  }

  if (nomeNorm) {
    const byNameAndMask = pfPartners.find(
      (entry) =>
        entry.nome_norm === nomeNorm &&
        ((entry.documento_clean.length === 6 && entry.documento_clean === cpfCore) ||
          (entry.documento_clean.length === 11 && entry.documento_clean === cpf)),
    );
    if (byNameAndMask) {
      return { ok: true, mode: "name_and_mask", partner: byNameAndMask };
    }

    const byNameOnly = pfPartners.filter((entry) => entry.nome_norm === nomeNorm);
    if (byNameOnly.length === 1) {
      return { ok: true, mode: "name_unique", partner: byNameOnly[0] };
    }
    if (byNameOnly.length > 1) {
      return { ok: false, reason: "same_name_multiple_partners" };
    }
  }

  return { ok: false, reason: "partner_not_found_in_company_qsa" };
}

async function queryCguByCpf({ sourceId, endpoint, queryParamName, cpf }) {
  const start = Date.now();

  if (!isSourceEnabled(sourceId)) {
    return {
      records: [],
      source: buildSourceStatus(sourceId, "unavailable", {
        latencyMs: Date.now() - start,
        statusReason: "feature_disabled",
      }),
    };
  }
  if (!PORTAL_TRANSPARENCIA_API_KEY) {
    return {
      records: [],
      source: buildSourceStatus(sourceId, "unavailable", {
        latencyMs: Date.now() - start,
        statusReason: "missing_api_key",
        message: "Configure PORTAL_TRANSPARENCIA_API_KEY para habilitar consultas CGU por CPF",
      }),
    };
  }

  const timeoutMs = getSourceConfig(sourceId).timeoutMs;
  const url =
    `https://api.portaldatransparencia.gov.br/api-de-dados/${endpoint}` +
    `?${queryParamName}=${encodeURIComponent(cpf)}&pagina=1`;
  const response = await fetchWithTimeout(url, timeoutMs, {
    headers: {
      "chave-api-dados": PORTAL_TRANSPARENCIA_API_KEY,
      accept: "application/json",
    },
  });

  if (!response) {
    return {
      records: [],
      source: buildSourceStatus(sourceId, "unavailable", {
        latencyMs: Date.now() - start,
        statusReason: "timeout_or_network",
      }),
    };
  }
  if (response.status === 401 || response.status === 403) {
    return {
      records: [],
      source: buildSourceStatus(sourceId, "unavailable", {
        latencyMs: Date.now() - start,
        statusReason: "unauthorized",
      }),
    };
  }
  if (response.status === 429) {
    return {
      records: [],
      source: buildSourceStatus(sourceId, "error", {
        latencyMs: Date.now() - start,
        statusReason: "rate_limited",
      }),
    };
  }
  if (!response.ok) {
    return {
      records: [],
      source: buildSourceStatus(sourceId, "error", {
        latencyMs: Date.now() - start,
        statusReason: `http_${response.status}`,
      }),
    };
  }

  const payload = await response.json().catch(() => null);
  const records = Array.isArray(payload) ? payload : [];

  return {
    records,
    source: buildSourceStatus(sourceId, records.length > 0 ? "success" : "not_found", {
      latencyMs: Date.now() - start,
      statusReason: records.length > 0 ? "match_found" : "not_listed",
      evidenceCount: records.length,
    }),
  };
}

async function loadTcuEleitoralCpfSet() {
  const source = getSourceConfig("tcu_eleitoral");
  if (tcuEleitoralCache && Date.now() - tcuEleitoralCache.fetchedAt < source.ttlMs) {
    return tcuEleitoralCache;
  }

  const response = await fetchWithTimeout(TCU_ELEITORAL_URL, source.timeoutMs);
  if (!response || !response.ok) {
    throw new Error("tcu_eleitoral_unavailable");
  }

  const csv = await response.text();
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

async function queryTcuEleitoralByCpf(cpf) {
  const sourceId = "tcu_eleitoral";
  const start = Date.now();

  if (!isSourceEnabled(sourceId)) {
    return {
      matched: false,
      source: buildSourceStatus(sourceId, "unavailable", {
        latencyMs: Date.now() - start,
        statusReason: "feature_disabled",
      }),
    };
  }

  try {
    const index = await loadTcuEleitoralCpfSet();
    const matched = index.cpfs.has(cpf);
    return {
      matched,
      source: buildSourceStatus(sourceId, matched ? "success" : "not_found", {
        latencyMs: Date.now() - start,
        statusReason: matched ? "match_found" : "not_listed",
        evidenceCount: matched ? 1 : 0,
      }),
    };
  } catch {
    return {
      matched: false,
      source: buildSourceStatus(sourceId, "unavailable", {
        latencyMs: Date.now() - start,
        statusReason: "index_load_failed",
      }),
    };
  }
}

function mergeRelatedCompanies(items, provider, outMap) {
  for (const item of items ?? []) {
    const cnpj = cleanDocument(item?.cnpj ?? "");
    if (cnpj.length !== 14) continue;

    const current = outMap.get(cnpj) ?? {
      cnpj,
      razao_social: "",
      uf: "",
      municipio: "",
      situacao_cadastral: "",
      providers: new Set(),
    };

    if (!current.razao_social && item?.razao_social) current.razao_social = String(item.razao_social).trim();
    if (!current.uf && item?.uf) current.uf = String(item.uf).trim();
    if (!current.municipio && item?.municipio) current.municipio = String(item.municipio).trim();
    if (!current.situacao_cadastral && item?.situacao_cadastral) {
      current.situacao_cadastral = String(item.situacao_cadastral).trim();
    }

    current.providers.add(provider);
    outMap.set(cnpj, current);
  }
}

async function queryReverseLookup(cpf, nome) {
  const companyMap = new Map();
  const providerStatuses = [];

  const bigqueryResult = await lookupCompaniesByCpf(cpf, 50);
  if (bigqueryResult.status === "success") {
    mergeRelatedCompanies(bigqueryResult.items, "bigquery", companyMap);
  }
  providerStatuses.push({
    source: "bigquery",
    status: bigqueryResult.status,
    reason: bigqueryResult.reason ?? "unknown",
    count: Array.isArray(bigqueryResult.items) ? bigqueryResult.items.length : 0,
  });

  const cpfMasked = buildCpfMaskedFromFull(cpf);
  let brazilioResult = { status: "not_found", reason: "missing_profile", items: [] };
  if (cpfMasked && normalizePersonName(nome)) {
    brazilioResult = await lookupCompaniesByMaskedProfile({
      cpfMasked,
      nome,
      limit: 50,
      allowScanOnMiss: true,
    });
    if (brazilioResult.status === "success") {
      mergeRelatedCompanies(brazilioResult.items, "brasilio", companyMap);
    }
  }

  providerStatuses.push({
    source: "brasilio",
    status: brazilioResult.status,
    reason: brazilioResult.reason ?? "unknown",
    count: Array.isArray(brazilioResult.items) ? brazilioResult.items.length : 0,
    from_cache: Boolean(brazilioResult.from_cache),
    source_last_modified: brazilioResult.source_last_modified ?? null,
  });

  const items = Array.from(companyMap.values()).map((item) => ({
    cnpj: item.cnpj,
    razao_social: item.razao_social,
    uf: item.uf,
    municipio: item.municipio,
    situacao_cadastral: item.situacao_cadastral,
    providers: Array.from(item.providers),
  }));

  const bigqueryMatched = providerStatuses.some((provider) => provider.source === "bigquery" && provider.count > 0);
  const brazilioMatched = providerStatuses.some((provider) => provider.source === "brasilio" && provider.count > 0);

  return {
    items,
    providerStatuses,
    status:
      items.length > 0
        ? "success"
        : bigqueryMatched || brazilioMatched
          ? "success"
          : "not_found",
    verification: bigqueryMatched ? "objective" : brazilioMatched ? "probable" : "possible",
  };
}

function buildSummary(classification, nome, flags) {
  if (!Array.isArray(flags) || flags.length === 0) {
    return `O sócio ${nome} não apresentou ocorrências relevantes nas fontes consultadas.`;
  }

  const top = flags
    .slice()
    .sort((a, b) => Number(b.weight ?? 0) - Number(a.weight ?? 0))
    .slice(0, 4)
    .map((flag) => flag.title)
    .join(", ");
  return `O sócio ${nome} apresentou ${flags.length} alerta(s): ${top}. Classificação final: ${classification}.`;
}

/**
 * @param {{ cnpj: string, cpf: string, nome?: string }} input
 */
export async function analyzePartner(input) {
  const cnpj = normalizeCnpj(input?.cnpj);
  const cpf = normalizeCpf(input?.cpf);
  const nome = String(input?.nome ?? "").trim();

  if (cnpj.length !== 14) {
    throw new PartnerHttpError(400, "CNPJ inválido");
  }
  if (cpf.length !== 11 || !isValidCpf(cpf)) {
    throw new PartnerHttpError(400, "CPF inválido");
  }

  const sources = [];
  const flags = [];

  const { company, source: receitaSource } = await fetchCompanyByCnpj(cnpj);
  sources.push(receitaSource);

  if (!company) {
    if (receitaSource.status === "not_found") {
      throw new PartnerHttpError(404, "Empresa não encontrada para o CNPJ informado");
    }
    if (receitaSource.status === "unavailable") {
      throw new PartnerHttpError(503, "Fonte de Receita indisponível no momento para validação do CNPJ");
    }
    throw new PartnerHttpError(502, "Falha ao obter dados da empresa para validar o vínculo societário");
  }

  const pfPartners = toPfPartnerEntries(company);
  if (pfPartners.length === 0) {
    throw new PartnerHttpError(400, "A empresa informada não possui sócios PF no QSA");
  }

  const partnerOwnership = resolvePartnerOwnership(pfPartners, cpf, nome);
  if (!partnerOwnership.ok) {
    if (partnerOwnership.reason === "same_name_multiple_partners") {
      throw new PartnerHttpError(
        400,
        "Há múltiplos sócios com este nome na empresa. Informe nome exato e CPF correspondente ao QSA.",
      );
    }
    throw new PartnerHttpError(400, "CPF/nome informado não pertence ao QSA da empresa informada");
  }

  const partnerName = partnerOwnership.partner?.nome || nome || "Sócio PF";
  const [ceafResult, servidoresResult, tcuResult, reverseResult] = await Promise.all([
    queryCguByCpf({
      sourceId: "cgu_ceaf",
      endpoint: "ceaf",
      queryParamName: "cpfSancionado",
      cpf,
    }),
    queryCguByCpf({
      sourceId: "cgu_servidores",
      endpoint: "servidores",
      queryParamName: "cpf",
      cpf,
    }),
    queryTcuEleitoralByCpf(cpf),
    queryReverseLookup(cpf, partnerName),
  ]);
  sources.push(ceafResult.source, servidoresResult.source, tcuResult.source);

  if (ceafResult.records.length > 0) {
    const sample = ceafResult.records[0] ?? null;
    flags.push({
      id: "cgu_ceaf_socio_expulso",
      source: "CGU",
      source_id: "cgu_ceaf",
      severity: "high",
      title: "Sócio listado no CEAF",
      description: `${partnerName} consta na base CEAF de expulsões da Administração Federal.`,
      weight: 25,
      confidence_level: "CONFIRMADO",
      verification_status: "objective",
      evidence: [
        { label: "Sócio", value: partnerName },
        { label: "CPF", value: cpf },
        ...(sample?.numeroProcesso ? [{ label: "Processo", value: String(sample.numeroProcesso) }] : []),
      ],
    });
  }

  if (servidoresResult.records.length > 0) {
    const sample = servidoresResult.records[0] ?? null;
    flags.push({
      id: "cgu_socio_servidor_federal",
      source: "CGU",
      source_id: "cgu_servidores",
      severity: "medium",
      title: "Sócio identificado como servidor federal",
      description: `${partnerName} possui vínculo com servidor público federal.`,
      weight: 10,
      confidence_level: "CONFIRMADO",
      verification_status: "objective",
      evidence: [
        { label: "Sócio", value: partnerName },
        { label: "CPF", value: cpf },
        ...(sample?.orgaoServidorLotacao?.nome
          ? [{ label: "Órgão", value: String(sample.orgaoServidorLotacao.nome) }]
          : []),
      ],
    });
  }

  if (tcuResult.matched) {
    flags.push({
      id: "tcu_implicacao_eleitoral_socio",
      source: "TCU",
      source_id: "tcu_eleitoral",
      severity: "high",
      title: "Sócio listado em contas irregulares com implicação eleitoral",
      description: `${partnerName} foi localizado na base eleitoral do TCU por CPF.`,
      weight: 20,
      confidence_level: "CONFIRMADO",
      verification_status: "objective",
      evidence: [
        { label: "Sócio", value: partnerName },
        { label: "CPF", value: cpf },
      ],
    });
  }

  const reverseBigquery = reverseResult.providerStatuses.find((item) => item.source === "bigquery");
  const reverseBrasilio = reverseResult.providerStatuses.find((item) => item.source === "brasilio");
  sources.push(
    buildSourceStatus(
      "reverse_lookup_bigquery",
      reverseBigquery?.count > 0 ? "success" : reverseBigquery?.status ?? "not_found",
      {
        statusReason: reverseBigquery?.reason ?? "unknown",
        evidenceCount: reverseBigquery?.count ?? 0,
        message: reverseBigquery?.reason ?? undefined,
      },
    ),
  );
  sources.push(
    buildSourceStatus(
      "reverse_lookup_brasilio",
      reverseBrasilio?.count > 0 ? "success" : reverseBrasilio?.status ?? "not_found",
      {
        statusReason: reverseBrasilio?.reason ?? "unknown",
        evidenceCount: reverseBrasilio?.count ?? 0,
        message: reverseBrasilio?.reason ?? undefined,
      },
    ),
  );

  if (reverseResult.items.length >= 4) {
    const verificationStatus = reverseResult.verification === "objective" ? "objective" : "probable";
    const confidenceLevel = verificationStatus === "objective" ? "CONFIRMADO" : "PROVAVEL";
    flags.push({
      id: "network_pf_multiplas_empresas",
      source: "Análise de Rede Societária",
      source_id: "network",
      severity: "medium",
      title: "Sócio com múltiplas empresas relacionadas",
      description:
        `${partnerName} está ligado a ${reverseResult.items.length} empresa(s) no reverse lookup PF->PJ.` +
        (verificationStatus === "objective"
          ? " Há confirmação por CPF completo."
          : " A confirmação foi obtida por perfil mascarado (nome + CPF parcial)."),
      weight: verificationStatus === "objective" ? 10 : 7,
      confidence_level: confidenceLevel,
      verification_status: verificationStatus,
      evidence: [
        { label: "Sócio", value: partnerName },
        { label: "CPF", value: cpf },
        { label: "Empresas relacionadas", value: String(reverseResult.items.length) },
        {
          label: "Exemplos de CNPJ",
          value: reverseResult.items
            .slice(0, 5)
            .map((item) => item.cnpj)
            .join(", "),
        },
      ],
    });
  }

  const { score, classification } = calculateScore(flags);
  const partial = sources.some((source) => source.status === "error" || source.status === "unavailable");

  return {
    person: {
      nome: partnerName,
      cpf,
      cpf_masked: buildCpfMaskedFromFull(cpf),
      company_link_validation: {
        status: "matched",
        mode: partnerOwnership.mode,
      },
    },
    company_context: {
      cnpj,
      razao_social: String(company?.razao_social ?? "").trim(),
      nome_fantasia: String(company?.nome_fantasia ?? "").trim(),
      situacao_cadastral: String(company?.descricao_situacao_cadastral ?? "").trim(),
      uf: String(company?.uf ?? "").trim(),
      municipio: String(company?.municipio ?? "").trim(),
    },
    score,
    classification,
    flags,
    sources,
    summary: buildSummary(classification, partnerName, flags),
    analyzed_at: new Date().toISOString(),
    related_entities: {
      reverse_lookup: {
        status: reverseResult.items.length > 0 ? "success" : "not_found",
        total_companies: reverseResult.items.length,
        providers: reverseResult.providerStatuses,
        items: reverseResult.items,
      },
    },
    meta: {
      partial,
      sources_version: SOURCES_VERSION,
      mode: "partner_scan",
    },
  };
}
