import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  cleanDocument,
  mapWithConcurrency,
  normalizePersonName,
  parseDelimitedLine,
  parseBooleanEnv,
  resolveHeaderIndexAny,
  toNumber,
} from "./common-utils.mjs";
import { fetchWithTimeout } from "./http-utils.mjs";
import { getIndexedSourceMatch, getLatestSnapshotAt, isSourceIndexStoreEnabled } from "./source-index-store.mjs";
import { getSourceConfig, isSourceEnabled, PGFN_SOURCE_IDS, SOURCES_VERSION } from "./source-registry.mjs";
import { calculateScore, calculateSubscores } from "./risk-scoring.mjs";
import { calculateDisambiguationScore, applyConvergenceBonus } from "./disambiguation-engine.mjs";
import { generateIntelligenceReport } from "./ai-synthesis.mjs";
import { enqueueDeepInvestigation } from "./investigation-orchestrator.mjs";
import { queryProcessosByCnpj, isDatajudEnabled } from "./datajud-query.mjs";

const PORTAL_TRANSPARENCIA_API_KEY = (process.env.PORTAL_TRANSPARENCIA_API_KEY ?? "").trim();
const SOCIO_CPF_QUERY_LIMIT = Number.parseInt(process.env.SOCIO_CPF_QUERY_LIMIT ?? "25", 10);
const SOCIO_CPF_CONCURRENCY = Number.parseInt(process.env.SOCIO_CPF_CONCURRENCY ?? "4", 10);
const execFileAsync = promisify(execFile);

const TCU_LICITANTES_URL =
  "https://sites.tcu.gov.br/dados-abertos/inidoneos-irregulares/arquivos/licitantes-inidoneos.csv";
const TCU_ELEITORAL_URL =
  "https://sites.tcu.gov.br/dados-abertos/inidoneos-irregulares/arquivos/resp-contas-julgadas-irreg-implicacao-eleitoral.csv";
const MTE_TRABALHO_ESCRAVO_URL =
  "https://www.gov.br/trabalho-e-emprego/pt-br/assuntos/inspecao-do-trabalho/areas-de-atuacao/cadastro_de_empregadores.csv";

/** @type {Map<string, { fetchedAt: number, value: string }>} */
const textCache = new Map();
/** @type {{ fetchedAt: number, cpfs: Set<string>, names: Map<string, { count: number, sampleCpfs: string[] }> } | null} */
let tcuEleitoralCache = null;

export class HttpError extends Error {
  /**
   * @param {number} statusCode
   * @param {string} message
   */
  constructor(statusCode, message) {
    super(message);
    this.name = "HttpError";
    this.statusCode = statusCode;
  }
}

function buildSourceStatus(sourceId, status, data = {}) {
  const source = getSourceConfig(sourceId);
  const payload = {
    id: source.id,
    name: source.name,
    status,
    latency_ms: data.latencyMs ?? 0,
    evidence_count: data.evidenceCount ?? 0,
  };

  if (data.message) payload.message = data.message;
  if (data.statusReason) payload.status_reason = data.statusReason;

  return payload;
}

function normalizeFlagVerification(flag) {
  const explicit = String(flag?.verification_status ?? "").toLowerCase();
  if (explicit === "objective" || explicit === "probable" || explicit === "possible") {
    return explicit;
  }

  const level = String(flag?.confidence_level ?? "").toUpperCase();
  if (level === "PROVAVEL") return "probable";
  if (level === "POSSIVEL") return "possible";
  return "objective";
}

function withVerificationStatus(flag) {
  return {
    ...flag,
    verification_status: normalizeFlagVerification(flag),
  };
}

function getValueByPath(record, path) {
  if (!record || typeof record !== "object") return undefined;
  const segments = String(path).split(".");

  let current = record;
  for (const segment of segments) {
    if (!current || typeof current !== "object") return undefined;
    current = current[segment];
  }

  return current;
}

function normalizeEvidenceValue(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const rendered = value
      .map((item) => normalizeEvidenceValue(item))
      .filter(Boolean)
      .slice(0, 3)
      .join(", ");
    return rendered;
  }
  if (typeof value === "object") {
    const namedValue = value.nome ?? value.descricao ?? value.nomeOrgao ?? value.sigla ?? value.codigo;
    if (namedValue) return String(namedValue).trim();
    return "";
  }
  return "";
}

function buildEvidenceItems(record, fieldSpecs) {
  if (!record || typeof record !== "object") return [];

  const items = [];
  for (const field of fieldSpecs) {
    const candidatePaths = Array.isArray(field.paths) ? field.paths : [field.paths];
    let normalizedValue = "";

    for (const candidatePath of candidatePaths) {
      const rawValue = getValueByPath(record, candidatePath);
      normalizedValue = normalizeEvidenceValue(rawValue);
      if (normalizedValue) break;
    }

    if (!normalizedValue) continue;
    items.push({
      label: field.label,
      value: normalizedValue,
    });
  }

  return items.slice(0, 6);
}

function collectRecordDocuments(record) {
  const candidates = [
    getValueByPath(record, "sancionado.codigoFormatado"),
    getValueByPath(record, "sancionado.cnpjFormatado"),
    getValueByPath(record, "sancionado.cnpj"),
    getValueByPath(record, "pessoa.cnpjFormatado"),
    getValueByPath(record, "pessoa.cnpj"),
    getValueByPath(record, "pessoaJuridica.cnpjFormatado"),
    getValueByPath(record, "pessoaJuridica.cnpj"),
  ];

  const sanctions = getValueByPath(record, "sancoes");
  if (Array.isArray(sanctions)) {
    for (const sanction of sanctions) {
      candidates.push(sanction?.cnpjFormatado);
      candidates.push(sanction?.cnpj);
    }
  }

  return candidates
    .map((value) => cleanDocument(value))
    .filter((value) => value.length === 14);
}

async function fetchJsonViaCurl(url, timeoutMs, headers) {
  const seconds = Math.max(5, Math.ceil(timeoutMs / 1000));
  const args = ["-sS", "--max-time", String(seconds), "-w", "\\n__HTTP_STATUS__:%{http_code}\\n"];

  for (const [key, value] of Object.entries(headers ?? {})) {
    if (value === undefined || value === null || value === "") continue;
    args.push("-H", `${key}: ${value}`);
  }

  args.push(url);

  try {
    const { stdout } = await execFileAsync("curl", args, { maxBuffer: 25 * 1024 * 1024 });
    const marker = "\n__HTTP_STATUS__:";
    const markerIndex = stdout.lastIndexOf(marker);
    if (markerIndex < 0) {
      return { kind: "invalid_json", statusCode: 0, payload: null };
    }

    const body = stdout.slice(0, markerIndex).trim();
    const statusCode = Number.parseInt(stdout.slice(markerIndex + marker.length).trim(), 10) || 0;

    if (statusCode === 401 || statusCode === 403) {
      return { kind: "unauthorized", statusCode, payload: null };
    }
    if (statusCode === 429) {
      return { kind: "rate_limited", statusCode, payload: null };
    }
    if (statusCode < 200 || statusCode >= 300) {
      return { kind: "http_error", statusCode, payload: null };
    }

    if (!body) {
      return { kind: "success", statusCode, payload: [] };
    }

    try {
      const payload = JSON.parse(body);
      return { kind: "success", statusCode, payload };
    } catch {
      return { kind: "invalid_json", statusCode, payload: null };
    }
  } catch {
    return { kind: "no_response", statusCode: 0, payload: null };
  }
}

async function fetchJsonWithCurlFallback(url, timeoutMs, headers) {
  const response = await fetchWithTimeout(url, timeoutMs, { headers });

  if (!response) {
    return { kind: "no_response", statusCode: 0, payload: null };
  }

  if (response.status === 401 || response.status === 403) {
    return { kind: "unauthorized", statusCode: response.status, payload: null };
  }
  if (response.status === 429) {
    return { kind: "rate_limited", statusCode: response.status, payload: null };
  }
  if (!response.ok) {
    return { kind: "http_error", statusCode: response.status, payload: null };
  }

  try {
    const payload = await response.json();
    return { kind: "success", statusCode: response.status, payload };
  } catch {
    return fetchJsonViaCurl(url, timeoutMs, headers);
  }
}

async function runSourceQuery(sourceId, executor) {
  const start = Date.now();

  if (!isSourceEnabled(sourceId)) {
    return {
      source: buildSourceStatus(sourceId, "unavailable", {
        latencyMs: Date.now() - start,
        statusReason: "feature_disabled",
        message: "Fonte desativada por feature flag",
      }),
      flags: [],
    };
  }

  try {
    const result = await executor(start);
    if (!result || typeof result !== "object") {
      return {
        source: buildSourceStatus(sourceId, "error", {
          latencyMs: Date.now() - start,
          statusReason: "invalid_source_result",
          message: "Fonte retornou resultado inválido",
        }),
        flags: [],
      };
    }

    if (!result.source) {
      return {
        source: buildSourceStatus(sourceId, "error", {
          latencyMs: Date.now() - start,
          statusReason: "missing_source_result",
          message: "Fonte sem metadados de status",
        }),
        flags: Array.isArray(result.flags) ? result.flags : [],
      };
    }

    if (!Number.isFinite(result.source.latency_ms) || result.source.latency_ms < 0) {
      result.source.latency_ms = Date.now() - start;
    }

    if (!Number.isFinite(result.source.evidence_count) || result.source.evidence_count < 0) {
      result.source.evidence_count = Array.isArray(result.flags) ? result.flags.length : 0;
    }

    return {
      ...result,
      source: result.source,
      flags: Array.isArray(result.flags) ? result.flags : [],
    };
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    return {
      source: buildSourceStatus(sourceId, "error", {
        latencyMs: Date.now() - start,
        statusReason: "unhandled_exception",
        message: `Erro inesperado ao processar a fonte: ${details}`,
      }),
      flags: [],
    };
  }
}

async function fetchTextCached(url, timeoutMs = 10000, ttlMs = 0) {
  if (ttlMs > 0) {
    const cached = textCache.get(url);
    if (cached && Date.now() - cached.fetchedAt < ttlMs) {
      return cached.value;
    }
  }

  const response = await fetchWithTimeout(url, timeoutMs);
  if (!response || !response.ok) {
    throw new Error(`Falha ao consultar ${url}`);
  }

  const text = await response.text();
  if (ttlMs > 0) {
    textCache.set(url, { fetchedAt: Date.now(), value: text });
  }

  return text;
}

function findCsvMatchesByDocument(csvText, delimiter, possibleDocumentHeaders, targetDocument, possibleSampleHeaders = []) {
  const lines = csvText.split(/\r?\n/);
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

    const columns = parseDelimitedLine(line, delimiter);
    const document = cleanDocument(columns[documentIndex] ?? "");
    if (document !== targetDocument) continue;

    count += 1;

    if (sampleIndex >= 0) {
      const sample = (columns[sampleIndex] ?? "").trim();
      if (sample) samples.add(sample);
    }
  }

  return { count, sampleValues: Array.from(samples).slice(0, 3) };
}

async function queryReceitaFederal(cnpj) {
  return runSourceQuery("receita_brasilapi", async (start) => {
    const source = getSourceConfig("receita_brasilapi");
    const response = await fetchWithTimeout(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, source.timeoutMs);

    if (!response || !response.ok) {
      return {
        source: buildSourceStatus("receita_brasilapi", "error", {
          latencyMs: Date.now() - start,
          statusReason: "upstream_error",
          message: "Não foi possível consultar",
        }),
        flags: [],
        receitaData: null,
      };
    }

    const payload = await response.json();
    if (!payload || typeof payload !== "object") {
      return {
        source: buildSourceStatus("receita_brasilapi", "error", {
          latencyMs: Date.now() - start,
          statusReason: "invalid_payload",
          message: "Resposta inválida da BrasilAPI",
        }),
        flags: [],
        receitaData: null,
      };
    }

    return {
      source: buildSourceStatus("receita_brasilapi", "success", {
        latencyMs: Date.now() - start,
        statusReason: "ok",
      }),
      flags: [],
      receitaData: payload,
    };
  });
}

async function queryCGUByCnpj(sourceId, endpoint, cnpjParamName, cnpj) {
  return runSourceQuery(sourceId, async (start) => {
    if (!PORTAL_TRANSPARENCIA_API_KEY) {
      return {
        source: buildSourceStatus(sourceId, "unavailable", {
          latencyMs: Date.now() - start,
          statusReason: "missing_api_key",
          message: "API indisponível (configure PORTAL_TRANSPARENCIA_API_KEY)",
        }),
        flags: [],
        data: null,
      };
    }

    const source = getSourceConfig(sourceId);
    const url = `https://api.portaldatransparencia.gov.br/api-de-dados/${endpoint}?${cnpjParamName}=${cnpj}&pagina=1`;
    const headers = {
      "chave-api-dados": PORTAL_TRANSPARENCIA_API_KEY,
      accept: "application/json",
    };

    const result = await fetchJsonWithCurlFallback(url, source.timeoutMs, headers);

    if (result.kind === "no_response") {
      return {
        source: buildSourceStatus(sourceId, "unavailable", {
          latencyMs: Date.now() - start,
          statusReason: "timeout_or_network",
          message: "Falha de rede/timeout na API da Transparência",
        }),
        flags: [],
        data: null,
      };
    }

    if (result.kind === "unauthorized") {
      return {
        source: buildSourceStatus(sourceId, "unavailable", {
          latencyMs: Date.now() - start,
          statusReason: "unauthorized",
          message: "Chave da API rejeitada pela Transparência",
        }),
        flags: [],
        data: null,
      };
    }

    if (result.kind === "rate_limited") {
      return {
        source: buildSourceStatus(sourceId, "error", {
          latencyMs: Date.now() - start,
          statusReason: "rate_limited",
          message: "Limite de requisições atingido na API da Transparência",
        }),
        flags: [],
        data: null,
      };
    }

    if (result.kind === "http_error") {
      return {
        source: buildSourceStatus(sourceId, "error", {
          latencyMs: Date.now() - start,
          statusReason: `http_${result.statusCode}`,
          message: "Falha ao consultar API da Transparência",
        }),
        flags: [],
        data: null,
      };
    }

    if (result.kind !== "success") {
      return {
        source: buildSourceStatus(sourceId, "error", {
          latencyMs: Date.now() - start,
          statusReason: "invalid_json_response",
          message: "Resposta inválida da API da Transparência (não JSON)",
        }),
        flags: [],
        data: null,
      };
    }

    const allRecords = Array.isArray(result.payload) ? result.payload : [];
    const records = allRecords.filter((record) => collectRecordDocuments(record).includes(cnpj));

    return {
      source: buildSourceStatus(sourceId, records.length > 0 ? "success" : "not_found", {
        latencyMs: Date.now() - start,
        statusReason: records.length > 0 ? "match_found" : "no_exact_document_match",
        evidenceCount: records.length,
      }),
      flags: [],
      data: records,
    };
  });
}

async function queryCEIS(cnpj) {
  const result = await queryCGUByCnpj("cgu_ceis", "ceis", "codigoSancionado", cnpj);

  if (result.source.status !== "success") return result;
  const sampleRecord = Array.isArray(result.data) ? result.data[0] : null;

  return {
    source: result.source,
    flags: [
      {
        id: "ceis",
        source: "CEIS (CGU)",
        severity: "critical",
        title: "Empresa no CEIS",
        description:
          "Cadastrada no Cadastro de Empresas Inidôneas e Suspensas. Impedida de contratar com a administração pública.",
        weight: 35,
        evidence: buildEvidenceItems(sampleRecord, [
          { label: "Tipo de sanção", paths: ["tipoSancao.descricao", "tipoSancao"] },
          { label: "Processo", paths: ["numeroProcesso"] },
          { label: "Órgão sancionador", paths: ["orgaoSancionador.nome", "orgaoSancionador"] },
          { label: "Início da sanção", paths: ["dataInicioSancao"] },
          { label: "Fim da sanção", paths: ["dataFimSancao"] },
          { label: "Link da publicação", paths: ["linkPublicacao"] },
        ]),
      },
    ],
  };
}

async function queryCNEP(cnpj) {
  const result = await queryCGUByCnpj("cgu_cnep", "cnep", "codigoSancionado", cnpj);

  if (result.source.status !== "success") return result;
  const sampleRecord = Array.isArray(result.data) ? result.data[0] : null;

  return {
    source: result.source,
    flags: [
      {
        id: "cnep",
        source: "CNEP (CGU)",
        severity: "critical",
        title: "Empresa no CNEP",
        description: "Cadastrada no Cadastro Nacional de Empresas Punidas por atos contra a administração pública.",
        weight: 35,
        evidence: buildEvidenceItems(sampleRecord, [
          { label: "Tipo de penalidade", paths: ["tipoSancao.descricao", "tipoSancao", "penalidade"] },
          { label: "Processo", paths: ["numeroProcesso", "processo"] },
          { label: "Órgão", paths: ["orgaoSancionador.nome", "orgaoSancionador", "orgao"] },
          { label: "Data de publicação", paths: ["dataPublicacaoSancao", "dataPublicacao"] },
          { label: "Fundamentação", paths: ["fundamentacao"] },
        ]),
      },
    ],
  };
}

async function queryCEPIM(cnpj) {
  const result = await queryCGUByCnpj("cgu_cepim", "cepim", "cnpjSancionado", cnpj);

  if (result.source.status !== "success") return result;
  const sampleRecord = Array.isArray(result.data) ? result.data[0] : null;

  return {
    source: result.source,
    flags: [
      {
        id: "cepim",
        source: "CEPIM (CGU)",
        severity: "high",
        title: "Entidade no CEPIM",
        description: "Cadastrada no CEPIM — impedida de receber transferências voluntárias.",
        weight: 25,
        evidence: buildEvidenceItems(sampleRecord, [
          { label: "Entidade", paths: ["entidade", "sancionado.nome", "pessoa.nome"] },
          { label: "Órgão", paths: ["orgaoResponsavel.nome", "orgaoResponsavel", "orgaoSancionador"] },
          { label: "Motivo", paths: ["motivo", "fundamentacao"] },
          { label: "Data de referência", paths: ["dataReferencia", "dataPublicacaoSancao"] },
        ]),
      },
    ],
  };
}

async function queryAcordosLeniencia(cnpj) {
  const result = await queryCGUByCnpj("cgu_acordos_leniencia", "acordos-leniencia", "cnpjSancionado", cnpj);

  if (result.source.status !== "success") return result;
  const sampleRecord = Array.isArray(result.data) ? result.data[0] : null;

  return {
    source: result.source,
    flags: [
      {
        id: "cgu_acordo_leniencia",
        source: "CGU",
        severity: "critical",
        title: "Empresa com Acordo de Leniência registrado",
        description: "A empresa consta na base de acordos de leniência da CGU.",
        weight: 30,
        evidence: buildEvidenceItems(sampleRecord, [
          { label: "Situação do acordo", paths: ["situacaoAcordo"] },
          { label: "Órgão responsável", paths: ["orgaoResponsavel.nome", "orgaoResponsavel"] },
          { label: "Início", paths: ["dataInicioAcordo"] },
          { label: "Fim", paths: ["dataFimAcordo"] },
          { label: "Quantidade de sanções", paths: ["quantidade"] },
        ]),
      },
    ],
  };
}

async function queryTCULicitantes(cnpj) {
  return runSourceQuery("tcu_licitantes", async (start) => {
    const source = getSourceConfig("tcu_licitantes");
    const csv = await fetchTextCached(TCU_LICITANTES_URL, source.timeoutMs, source.ttlMs);
    const matches = findCsvMatchesByDocument(
      csv,
      "|",
      ["CPF_CNPJ", "CPF/CNPJ"],
      cnpj,
      ["PROCESSO", "NR_PROCESSO"],
    );

    if (matches.count === 0) {
      return {
        source: buildSourceStatus("tcu_licitantes", "not_found", {
          latencyMs: Date.now() - start,
          statusReason: "not_listed",
        }),
        flags: [],
      };
    }

    const sample = matches.sampleValues.length > 0 ? ` Exemplo de processo: ${matches.sampleValues[0]}.` : "";
    return {
      source: buildSourceStatus("tcu_licitantes", "success", {
        latencyMs: Date.now() - start,
        statusReason: "match_found",
        evidenceCount: matches.count,
      }),
      flags: [
        {
          id: "tcu_licitantes_inidoneos",
          source: "TCU",
          severity: "critical",
          title: "Empresa em lista do TCU (Licitantes Inidôneos)",
          description: `Foram encontrados ${matches.count} registro(s) na base de licitantes inidôneos.${sample}`,
          weight: 35,
          evidence: [
            { label: "Registros encontrados", value: String(matches.count) },
            ...(matches.sampleValues[0] ? [{ label: "Processo (exemplo)", value: matches.sampleValues[0] }] : []),
          ],
        },
      ],
    };
  });
}

async function queryMTETrabalhoEscravo(cnpj) {
  return runSourceQuery("mte_trabalho_escravo", async (start) => {
    const source = getSourceConfig("mte_trabalho_escravo");
    const csv = await fetchTextCached(MTE_TRABALHO_ESCRAVO_URL, source.timeoutMs, source.ttlMs);
    const matches = findCsvMatchesByDocument(
      csv,
      ";",
      ["CNPJ/CPF", "CPF_CNPJ", "CNPJ_CPF"],
      cnpj,
      ["Empregador", "NOME_EMPREGADOR"],
    );

    if (matches.count === 0) {
      return {
        source: buildSourceStatus("mte_trabalho_escravo", "not_found", {
          latencyMs: Date.now() - start,
          statusReason: "not_listed",
        }),
        flags: [],
      };
    }

    const sampleEmployer = matches.sampleValues.length > 0 ? ` Exemplo: ${matches.sampleValues[0]}.` : "";
    return {
      source: buildSourceStatus("mte_trabalho_escravo", "success", {
        latencyMs: Date.now() - start,
        statusReason: "match_found",
        evidenceCount: matches.count,
      }),
      flags: [
        {
          id: "mte_trabalho_escravo",
          source: "MTE",
          severity: "critical",
          title: "Empresa no cadastro de trabalho escravo",
          description: `Foram encontradas ${matches.count} ocorrência(s) no cadastro de empregadores que submeteram trabalhadores a condições análogas à escravidão.${sampleEmployer}`,
          weight: 35,
          evidence: [
            { label: "Ocorrências", value: String(matches.count) },
            ...(matches.sampleValues[0] ? [{ label: "Empregador (exemplo)", value: matches.sampleValues[0] }] : []),
          ],
        },
      ],
    };
  });
}

async function queryMTEAutuacoes(cnpj) {
  const result = await queryCGUByCnpj("mte_autuacoes", "autos-de-infracao", "cnpjEstabelecimento", cnpj);
  if (result.source.status !== "success") return { source: result.source, flags: [] };

  const records = Array.isArray(result.data) ? result.data : [];
  if (records.length === 0) return { source: result.source, flags: [] };

  const sampleRecord = records[0];

  // Detectar embargos de obra (gravidade maior)
  const embargos = records.filter((r) => {
    const tipo = String(
      r.tipoAcao?.descricao ?? r.tipoInfracao?.descricao ?? r.enquadramento ?? "",
    ).toLowerCase();
    return tipo.includes("embargo") || tipo.includes("interdi");
  });

  const flags = [];

  if (embargos.length > 0) {
    flags.push(withVerificationStatus({
      id: "mte_embargo_obra",
      source_id: "mte_autuacoes",
      source: "MTE — Autos de Infração",
      severity: "high",
      title: `Empresa com ${embargos.length} embargo(s)/interdição(ões) MTE`,
      description: `Foram encontrados ${embargos.length} ato(s) de embargo ou interdição de obra pelo MTE. Indica violação grave de norma de segurança do trabalho.`,
      weight: 20,
      evidence: [
        { label: "Embargos/interdições", value: String(embargos.length) },
        ...(embargos[0]?.tipoAcao?.descricao ? [{ label: "Tipo", value: embargos[0].tipoAcao.descricao }] : []),
        ...(embargos[0]?.dataDecisao ? [{ label: "Data", value: embargos[0].dataDecisao }] : []),
      ],
    }));
  }

  const regularCount = records.length - embargos.length;
  if (regularCount > 0) {
    const totalMulta = records.reduce((s, r) => s + (Number(r.valorMulta) || 0), 0);
    flags.push(withVerificationStatus({
      id: "mte_autuacao_trabalhista",
      source_id: "mte_autuacoes",
      source: "MTE — Autos de Infração",
      severity: records.length >= 5 ? "high" : "medium",
      title: `Empresa com ${records.length} autuação(ões) trabalhista(s) no MTE`,
      description: `Foram encontradas ${records.length} autuação(ões) trabalhistas registradas no Portal da Transparência (MTE). Indica infrações à CLT ou normas regulamentadoras.`,
      weight: records.length >= 5 ? 20 : 15,
      evidence: [
        { label: "Total de autuações", value: String(records.length) },
        ...(totalMulta > 0
          ? [{ label: "Valor de multas (soma)", value: totalMulta.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) }]
          : []),
        ...(sampleRecord?.tipoInfracao?.descricao ? [{ label: "Tipo (exemplo)", value: sampleRecord.tipoInfracao.descricao }] : []),
        ...(sampleRecord?.enquadramento ? [{ label: "Enquadramento (exemplo)", value: String(sampleRecord.enquadramento).slice(0, 80) }] : []),
      ],
    }));
  }

  return { source: result.source, flags };
}

async function queryPGFNIndexed(sourceId, cnpj, options) {
  return runSourceQuery(sourceId, async (start) => {
    if (!isSourceIndexStoreEnabled()) {
      return {
        source: buildSourceStatus(sourceId, "unavailable", {
          latencyMs: Date.now() - start,
          statusReason: "missing_database_url",
          message: "Índice PGFN indisponível (configure DATABASE_URL)",
        }),
        flags: [],
      };
    }

    let sourceSnapshotAt = null;
    try {
      sourceSnapshotAt = await getLatestSnapshotAt([sourceId]);
    } catch {
      sourceSnapshotAt = null;
    }

    if (!sourceSnapshotAt) {
      return {
        source: buildSourceStatus(sourceId, "unavailable", {
          latencyMs: Date.now() - start,
          statusReason: "snapshot_not_ready_for_source",
          message: "Índice PGFN desta fonte ainda não carregado. Execute o sync diário.",
        }),
        flags: [],
      };
    }

    try {
      const match = await getIndexedSourceMatch(sourceId, cnpj);

      if (!match) {
        return {
          source: buildSourceStatus(sourceId, "not_found", {
            latencyMs: Date.now() - start,
            statusReason: "not_listed",
          }),
          flags: [],
        };
      }

      return {
        source: buildSourceStatus(sourceId, "success", {
          latencyMs: Date.now() - start,
          statusReason: "match_found",
          evidenceCount: 1,
        }),
        flags: [
          {
            id: options.flagId,
            source: "PGFN",
            severity: options.severity,
            title: options.title,
            description: options.description,
            weight: options.weight,
            evidence: [
              { label: "Documento", value: cnpj },
              { label: "Fonte indexada", value: sourceId },
            ],
          },
        ],
      };
    } catch {
      return {
        source: buildSourceStatus(sourceId, "error", {
          latencyMs: Date.now() - start,
          statusReason: "index_query_failed",
          message: "Falha ao consultar índice PGFN no Postgres",
        }),
        flags: [],
      };
    }
  });
}

async function loadTCUEleitoralIndex() {
  const source = getSourceConfig("tcu_eleitoral");

  if (tcuEleitoralCache && Date.now() - tcuEleitoralCache.fetchedAt < source.ttlMs) {
    return tcuEleitoralCache;
  }

  const csv = await fetchTextCached(TCU_ELEITORAL_URL, source.timeoutMs, source.ttlMs);
  const lines = csv.split(/\r?\n/);
  const cpfs = new Set();
  /** @type {Map<string, { count: number, sampleCpfs: Set<string> }>} */
  const names = new Map();

  if (lines.length > 0) {
    const headers = parseDelimitedLine(lines[0], "|");
    const nameIndex = resolveHeaderIndexAny(headers, ["NOME"]);
    const cpfIndex = resolveHeaderIndexAny(headers, ["CPF"]);

    for (let i = 1; i < lines.length; i += 1) {
      const line = lines[i];
      if (!line) continue;

      const columns = parseDelimitedLine(line, "|");
      const cpf = cleanDocument(columns[cpfIndex] ?? "");
      const name = normalizePersonName(columns[nameIndex] ?? "");

      if (cpf.length === 11) cpfs.add(cpf);

      if (!name) continue;
      const current = names.get(name) ?? { count: 0, sampleCpfs: new Set() };
      current.count += 1;
      if (cpf.length === 11 && current.sampleCpfs.size < 3) {
        current.sampleCpfs.add(cpf);
      }
      names.set(name, current);
    }
  }

  const namesIndex = new Map();
  for (const [name, info] of names.entries()) {
    namesIndex.set(name, { count: info.count, sampleCpfs: Array.from(info.sampleCpfs) });
  }

  tcuEleitoralCache = { fetchedAt: Date.now(), cpfs, names: namesIndex };
  return tcuEleitoralCache;
}

async function queryTCUEleitoral(partners) {
  return runSourceQuery("tcu_eleitoral", async (start) => {
    const personPartners = partners.filter((partner) => partner?.tipo === "PF");
    if (personPartners.length === 0) {
      return {
        source: buildSourceStatus("tcu_eleitoral", "unavailable", {
          latencyMs: Date.now() - start,
          statusReason: "no_person_partners",
          message: "Empresa sem sócios PF no QSA para validação eleitoral",
        }),
        flags: [],
      };
    }

    const partnerWithCpf = personPartners
      .map((partner) => ({
        partner,
        cpf: cleanDocument(partner.cnpj_cpf_do_socio ?? ""),
      }))
      .filter((entry) => entry.cpf.length === 11);

    const eleitoralIndex = await loadTCUEleitoralIndex();

    const matchedByCpf = partnerWithCpf
      .filter((entry) => eleitoralIndex.cpfs.has(entry.cpf))
      .map((entry) => entry.partner);

    if (matchedByCpf.length > 0) {
      const partnerNames = matchedByCpf.map((partner) => partner.nome).slice(0, 3).join(", ");
      return {
        source: buildSourceStatus("tcu_eleitoral", "success", {
          latencyMs: Date.now() - start,
          statusReason: "match_found",
          evidenceCount: matchedByCpf.length,
        }),
        flags: [
          {
            id: "tcu_implicacao_eleitoral_socio",
            source: "TCU",
            severity: "high",
            title: "Sócio listado em contas irregulares com implicação eleitoral",
            description: `Foram encontrados ${matchedByCpf.length} sócio(s) na base do TCU por correspondência de CPF. Exemplos: ${partnerNames}.`,
            weight: 20,
            evidence: [
              { label: "Sócios com ocorrência", value: String(matchedByCpf.length) },
              ...(partnerNames ? [{ label: "Sócios (exemplo)", value: partnerNames }] : []),
            ],
          },
        ],
      };
    }

    const matchedByName = personPartners.flatMap((partner) => {
      const normalizedName = normalizePersonName(partner.nome ?? "");
      if (!normalizedName || normalizedName.split(" ").length < 3) return [];

      const match = eleitoralIndex.names.get(normalizedName);
      if (!match) return [];

      return [
        {
          partner,
          occurrences: match.count,
        },
      ];
    });

    if (matchedByName.length === 0) {
      return {
        source: buildSourceStatus("tcu_eleitoral", "not_found", {
          latencyMs: Date.now() - start,
          statusReason: "not_listed",
        }),
        flags: [],
      };
    }

    const uniqueMatchedNames = Array.from(new Set(matchedByName.map((match) => match.partner.nome)));
    const partnerNames = uniqueMatchedNames.slice(0, 3).join(", ");
    const ambiguousMatches = matchedByName.filter((match) => match.occurrences > 1).length;
    const confidenceNote =
      ambiguousMatches > 0
        ? "A validação foi feita por nome (CPF mascarado na Receita) e pode conter homônimos."
        : "A validação foi feita por nome com correspondência única na base.";

    return {
      source: buildSourceStatus("tcu_eleitoral", "success", {
        latencyMs: Date.now() - start,
        statusReason: "match_found_by_name",
        evidenceCount: uniqueMatchedNames.length,
      }),
      flags: [
        {
          id: "tcu_implicacao_eleitoral_socio_nome",
          source: "TCU",
          severity: "medium",
          title: "Sócio possivelmente listado em contas irregulares com implicação eleitoral",
          description: `Foram encontrados ${uniqueMatchedNames.length} sócio(s) na base do TCU por correspondência de nome. Exemplos: ${partnerNames}. ${confidenceNote}`,
          weight: 10,
          confidence_level: ambiguousMatches > 0 ? "POSSIVEL" : "PROVAVEL",
          evidence: [
            { label: "Sócios com correspondência por nome", value: String(uniqueMatchedNames.length) },
            ...(partnerNames ? [{ label: "Sócios (exemplo)", value: partnerNames }] : []),
          ],
        },
      ],
    };
  });
}

function extractPartnerCpfEntries(partners) {
  const personPartners = partners.filter((partner) => partner?.tipo === "PF");
  const seen = new Set();
  const cpfs = [];
  let maskedCount = 0;

  for (const partner of personPartners) {
    const rawDocument = String(partner.cnpj_cpf_do_socio ?? "").trim();
    const cleaned = cleanDocument(rawDocument);

    if (cleaned.length === 11) {
      if (!seen.has(cleaned)) {
        seen.add(cleaned);
        cpfs.push({
          cpf: cleaned,
          nome: partner.nome,
        });
      }
      continue;
    }

    if (rawDocument) {
      maskedCount += 1;
    }
  }

  return {
    personPartnerCount: personPartners.length,
    cpfs,
    maskedCount,
  };
}

async function queryCGUByCpf(sourceId, endpoint, queryParamName, cpf) {
  if (!PORTAL_TRANSPARENCIA_API_KEY) {
    return { type: "unavailable", records: [] };
  }

  const source = getSourceConfig(sourceId);
  const url = `https://api.portaldatransparencia.gov.br/api-de-dados/${endpoint}?${queryParamName}=${cpf}&pagina=1`;
  const result = await fetchJsonWithCurlFallback(url, source.timeoutMs, {
    "chave-api-dados": PORTAL_TRANSPARENCIA_API_KEY,
    accept: "application/json",
  });

  if (result.kind === "no_response") return { type: "unavailable", records: [] };
  if (result.kind === "unauthorized") return { type: "unavailable", records: [] };
  if (result.kind !== "success") return { type: "error", records: [] };

  return {
    type: "success",
    records: Array.isArray(result.payload) ? result.payload : [],
  };
}

async function queryCGUCpfPartners({ sourceId, endpoint, queryParamName, partners, flagFactory }) {
  return runSourceQuery(sourceId, async (start) => {
    if (!PORTAL_TRANSPARENCIA_API_KEY) {
      return {
        source: buildSourceStatus(sourceId, "unavailable", {
          latencyMs: Date.now() - start,
          statusReason: "missing_api_key",
          message: "API indisponível (configure PORTAL_TRANSPARENCIA_API_KEY)",
        }),
        flags: [],
      };
    }

    const cpfData = extractPartnerCpfEntries(partners);

    if (cpfData.personPartnerCount === 0) {
      return {
        source: buildSourceStatus(sourceId, "unavailable", {
          latencyMs: Date.now() - start,
          statusReason: "no_person_partners",
          message: "Empresa sem sócios PF no QSA",
        }),
        flags: [],
      };
    }

    if (cpfData.cpfs.length === 0) {
      return {
        source: buildSourceStatus(sourceId, "unavailable", {
          latencyMs: Date.now() - start,
          statusReason: "masked_or_missing_cpf",
          message: "Não há CPF completo de sócios PF para consulta",
        }),
        flags: [],
      };
    }

    const scopedCpfs = cpfData.cpfs.slice(0, Math.max(1, SOCIO_CPF_QUERY_LIMIT));

    const perCpfResults = await mapWithConcurrency(scopedCpfs, Math.max(1, SOCIO_CPF_CONCURRENCY), async (entry) => {
      const result = await queryCGUByCpf(sourceId, endpoint, queryParamName, entry.cpf);
      return {
        cpf: entry.cpf,
        nome: entry.nome,
        type: result.type,
        records: result.records,
      };
    });

    const successResponses = perCpfResults.filter((entry) => entry.type === "success");
    const errorResponses = perCpfResults.filter((entry) => entry.type === "error");
    const matched = successResponses.filter((entry) => entry.records.length > 0);
    const sampleRecords = matched.flatMap((entry) =>
      entry.records.slice(0, 1).map((record) => ({
        nome: entry.nome,
        cpf: entry.cpf,
        record,
      })),
    );

    if (matched.length > 0) {
      const partnerNames = Array.from(new Set(matched.map((entry) => entry.nome))).slice(0, 3);
      return {
        source: buildSourceStatus(sourceId, "success", {
          latencyMs: Date.now() - start,
          statusReason: "match_found",
          evidenceCount: matched.length,
        }),
        flags: [flagFactory({
          matchedCount: matched.length,
          partnerNames,
          checkedCount: scopedCpfs.length,
          maskedCount: cpfData.maskedCount,
          sampleRecords,
        })],
      };
    }

    if (successResponses.length > 0) {
      return {
        source: buildSourceStatus(sourceId, "not_found", {
          latencyMs: Date.now() - start,
          statusReason: "not_listed",
          message:
            cpfData.maskedCount > 0
              ? `Consulta executada para ${scopedCpfs.length} sócio(s) com CPF completo. ${cpfData.maskedCount} CPF(s) mascarado(s) não puderam ser validados.`
              : `Consulta executada para ${scopedCpfs.length} sócio(s) com CPF completo.`,
        }),
        flags: [],
      };
    }

    if (errorResponses.length > 0) {
      return {
        source: buildSourceStatus(sourceId, "error", {
          latencyMs: Date.now() - start,
          statusReason: "upstream_error",
          message: "Falha ao consultar API da Transparência para CPFs de sócios",
        }),
        flags: [],
      };
    }

    return {
      source: buildSourceStatus(sourceId, "unavailable", {
        latencyMs: Date.now() - start,
        statusReason: "unavailable_for_all_cpfs",
        message: "API da Transparência indisponível para consultas por CPF",
      }),
      flags: [],
    };
  });
}

async function queryCEAF(partners) {
  return queryCGUCpfPartners({
    sourceId: "cgu_ceaf",
    endpoint: "ceaf",
    queryParamName: "cpfSancionado",
    partners,
    flagFactory: ({ matchedCount, partnerNames, maskedCount, sampleRecords }) => {
      const namesText = partnerNames.length > 0 ? ` Exemplos: ${partnerNames.join(", ")}.` : "";
      const maskedText =
        maskedCount > 0
          ? ` ${maskedCount} CPF(s) mascarado(s) na Receita/BrasilAPI não foram verificáveis.`
          : "";
      const sampleRecord = sampleRecords[0]?.record ?? null;

      return {
        id: "cgu_ceaf_socio_expulso",
        source: "CGU",
        severity: "high",
        title: "Sócio listado no CEAF",
        description: `${matchedCount} sócio(s) constam no CEAF como expulsos da Administração Federal.${namesText}${maskedText}`,
        weight: 25,
        evidence: [
          { label: "Sócios com ocorrência", value: String(matchedCount) },
          ...(sampleRecords[0]?.nome ? [{ label: "Sócio (exemplo)", value: sampleRecords[0].nome }] : []),
          ...buildEvidenceItems(sampleRecord, [
            { label: "Tipo de sanção", paths: ["tipoSancao.descricao", "tipoSancao"] },
            { label: "Processo", paths: ["numeroProcesso", "processo"] },
            { label: "Órgão", paths: ["orgaoSancionador.nome", "orgaoSancionador", "orgao"] },
            { label: "Início", paths: ["dataInicioSancao", "dataInicio"] },
            { label: "Fim", paths: ["dataFimSancao", "dataFim"] },
          ]),
        ].slice(0, 6),
      };
    },
  });
}

async function queryServidoresFederais(partners) {
  return queryCGUCpfPartners({
    sourceId: "cgu_servidores",
    endpoint: "servidores",
    queryParamName: "cpf",
    partners,
    flagFactory: ({ matchedCount, partnerNames, sampleRecords }) => {
      const namesText = partnerNames.length > 0 ? ` Exemplos: ${partnerNames.join(", ")}.` : "";
      const sampleRecord = sampleRecords[0]?.record ?? null;

      return {
        id: "cgu_socio_servidor_federal",
        source: "CGU",
        severity: "medium",
        title: "Sócio identificado como servidor federal",
        description: `${matchedCount} sócio(s) identificados como servidor público federal ativo — possível conflito de interesse.${namesText}`,
        weight: 10,
        evidence: [
          { label: "Sócios com vínculo", value: String(matchedCount) },
          ...(sampleRecords[0]?.nome ? [{ label: "Sócio (exemplo)", value: sampleRecords[0].nome }] : []),
          ...buildEvidenceItems(sampleRecord, [
            { label: "Órgão", paths: ["orgaoServidorLotacao.nome", "orgaoServidorLotacao"] },
            { label: "Cargo", paths: ["funcao.nome", "cargo.nome", "funcao"] },
            { label: "Situação", paths: ["situacaoVinculo", "situacao"] },
          ]),
        ].slice(0, 6),
      };
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Agente 2 — Risco de sócios PJ (recursivo, depth=1)
// ─────────────────────────────────────────────────────────────────────────────

async function analyzePartnerRisk(partnerCnpj) {
  const cleanCnpj = cleanDocument(partnerCnpj);
  if (cleanCnpj.length !== 14) return { risk_flags: [], risk_score: 0, risk_classification: "Baixo" };

  try {
    const [ceisResult, cnepResult, tcuResult, pgfnFgtsResult, pgfnPrevidResult, pgfnNpResult] =
      await Promise.all([
        queryCEIS(cleanCnpj),
        queryCNEP(cleanCnpj),
        queryTCULicitantes(cleanCnpj),
        queryPGFNIndexed("pgfn_fgts", cleanCnpj, {
          flagId: "pgfn_fgts_divida_ativa_parceiro",
          severity: "medium",
          weight: 15,
          title: "Sócio PJ com inscrição em dívida ativa (FGTS)",
          description: "Empresa parceira consta na dívida ativa FGTS.",
        }),
        queryPGFNIndexed("pgfn_previdenciario", cleanCnpj, {
          flagId: "pgfn_previd_divida_ativa_parceiro",
          severity: "medium",
          weight: 15,
          title: "Sócio PJ com dívida ativa previdenciária",
          description: "Empresa parceira consta na dívida ativa previdenciária.",
        }),
        queryPGFNIndexed("pgfn_nao_previdenciario", cleanCnpj, {
          flagId: "pgfn_np_divida_ativa_parceiro",
          severity: "medium",
          weight: 20,
          title: "Sócio PJ com dívida ativa não-previdenciária",
          description: "Empresa parceira consta na dívida ativa não-previdenciária.",
        }),
      ]);

    const partnerFlags = [];
    for (const result of [ceisResult, cnepResult, tcuResult, pgfnFgtsResult, pgfnPrevidResult, pgfnNpResult]) {
      for (const flag of result.flags) {
        partnerFlags.push({ ...flag, depth: 1 });
      }
    }

    const { score: risk_score, classification: risk_classification } = calculateScore(partnerFlags);
    return { risk_flags: partnerFlags, risk_score, risk_classification };
  } catch {
    return { risk_flags: [], risk_score: 0, risk_classification: "Baixo" };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Agente 2b — Rede societária depth=2 (FEATURE_DEEP_NETWORK=true)
// Limites: máx 5 nós, 10s/nó, 30s total, contribuição ao score via depth_factor=0.63
// ─────────────────────────────────────────────────────────────────────────────

const DEEP_NETWORK_MAX_NODES = 5;
const DEEP_NETWORK_NODE_TIMEOUT_MS = 10_000;
const DEEP_NETWORK_TOTAL_TIMEOUT_MS = 30_000;

function isDeepNetworkEnabled() {
  return parseBooleanEnv(process.env.FEATURE_DEEP_NETWORK, false);
}

/**
 * Analisa empresas a depth=2 na rede societária.
 * Recebe os itens de depth=1 (já enriquecidos com risk_score) e:
 *   1. Busca o QSA de cada depth=1 (prioriza os com maior risco)
 *   2. Coleta sócios PJ únicos (depth=2), máx DEEP_NETWORK_MAX_NODES
 *   3. Analisa risco de cada depth=2 via analyzePartnerRisk
 *   4. Gera flag SOCIO_CENTRAL_REDE quando um sócio aparece em ≥5 empresas
 *
 * @param {Array} depth1Items — itens do queryPartnerCompaniesByCnpj
 * @returns {Promise<Array>} flags com depth=2
 */
async function analyzeDepth2Network(depth1Items) {
  if (!Array.isArray(depth1Items) || depth1Items.length === 0) return [];

  const startTotal = Date.now();

  // Prioriza depth=1 com maior risco
  const sorted = [...depth1Items]
    .filter((item) => cleanDocument(item?.cnpj ?? "").length === 14)
    .sort((a, b) => (b.risk_score ?? 0) - (a.risk_score ?? 0));

  // Coleta PJ sócios de cada depth=1 empresa (QSA da BrasilAPI)
  // Map: cnpj_depth2 → { partnerNames: string[], fromCompanies: string[] }
  const depth2Map = new Map();

  for (const item of sorted) {
    if (Date.now() - startTotal >= DEEP_NETWORK_TOTAL_TIMEOUT_MS) break;
    if (depth2Map.size >= DEEP_NETWORK_MAX_NODES) break;

    try {
      const controller = new AbortController();
      const nodeTimer = setTimeout(() => controller.abort(), DEEP_NETWORK_NODE_TIMEOUT_MS);

      const response = await fetch(
        `https://brasilapi.com.br/api/cnpj/v1/${item.cnpj}`,
        { signal: controller.signal },
      );

      clearTimeout(nodeTimer);
      if (!response.ok) continue;

      const payload = await response.json();
      const pjSocios = (payload?.qsa ?? []).filter((s) => {
        const doc = cleanDocument(s?.cnpj_cpf_do_socio ?? "");
        return doc.length === 14;
      });

      for (const socio of pjSocios) {
        if (depth2Map.size >= DEEP_NETWORK_MAX_NODES) break;
        const doc = cleanDocument(socio.cnpj_cpf_do_socio);
        if (!depth2Map.has(doc)) {
          depth2Map.set(doc, { partnerNames: [], fromCompanies: [] });
        }
        const meta = depth2Map.get(doc);
        meta.partnerNames.push(socio.nome ?? "");
        meta.fromCompanies.push(item.razao_social ?? item.cnpj);
      }
    } catch {
      // fail-open — ignora timeout ou erro de rede
    }
  }

  if (depth2Map.size === 0) return [];

  const flags = [];

  // Analisa risco de cada depth=2 CNPJ
  for (const [cnpj, meta] of depth2Map) {
    if (Date.now() - startTotal >= DEEP_NETWORK_TOTAL_TIMEOUT_MS) break;

    try {
      const result = await analyzePartnerRisk(cnpj);
      for (const flag of result.risk_flags) {
        flags.push({
          ...flag,
          depth: 2,
          evidence: [
            ...(Array.isArray(flag.evidence) ? flag.evidence : []),
            { label: "CNPJ sócio depth=2", value: cnpj },
            { label: "Via empresa(s) depth=1", value: [...new Set(meta.fromCompanies)].join(", ") },
          ],
        });
      }
    } catch {
      // fail-open
    }
  }

  // Flag de centralidade: sócio que aparece em ≥5 empresas no conjunto depth=1
  // (detectado via fromCompanies de múltiplos depth=2 pontos)
  const centralityCounter = new Map();
  for (const [cnpj, meta] of depth2Map) {
    const count = new Set(meta.fromCompanies).size;
    if (count >= 5) {
      centralityCounter.set(cnpj, count);
    }
  }
  for (const [cnpj, count] of centralityCounter) {
    flags.push(withVerificationStatus({
      id: `socio_central_rede_${cnpj}`,
      source: "Análise de rede societária (depth=2)",
      severity: "high",
      title: "Sócio central em rede societária ampla",
      description: `Empresa CNPJ ${cnpj} aparece como sócia em ${count} empresas da rede investigada. Padrão típico de estruturas de laranja.`,
      weight: 25,
      depth: 2,
      evidence: [
        { label: "CNPJ do sócio central", value: cnpj },
        { label: "Empresas na rede", value: String(count) },
      ],
    }));
  }

  return flags;
}

// ─────────────────────────────────────────────────────────────────────────────
// DataJud — Processos Judiciais (CNJ)
// ─────────────────────────────────────────────────────────────────────────────

async function queryDatajud(cnpj, company) {
  return runSourceQuery("datajud", async (start) => {
    if (!isDatajudEnabled()) {
      return {
        source: buildSourceStatus("datajud", "unavailable", {
          latencyMs: Date.now() - start,
          statusReason: "feature_disabled",
          message: "DataJud desabilitado (FEATURE_DATAJUD=false)",
        }),
        processes: [],
        flags: [],
      };
    }

    const uf = company?.uf ?? "";
    const result = await queryProcessosByCnpj(cnpj, { uf });

    if (result.status === "unavailable" || result.status === "invalid") {
      const message = result.message
        ? result.message
        : (result.errorSummary && result.status === "unavailable")
          ? `DataJud indisponível nos tribunais consultados (${result.errorSummary})`
          : undefined;
      return {
        source: buildSourceStatus("datajud", "unavailable", {
          latencyMs: Date.now() - start,
          statusReason: result.statusReason ?? result.status,
          message,
        }),
        processes: [],
        flags: [],
      };
    }

    const flags = [];
    const { byType, total, tribunaisConsultados } = result;
    const tribunaisComErro = (result.tribunalErrors ?? [])
      .map((item) => `${item.tribunal} (${item.reason})`)
      .slice(0, 6);

    const evidenceBase = [
      { label: "Tribunais consultados", value: (tribunaisConsultados ?? []).join(", ") },
      { label: "Total de processos encontrados", value: String(total) },
      ...(tribunaisComErro.length > 0
        ? [{ label: "Tribunais com erro", value: tribunaisComErro.join("; ") }]
        : []),
    ];

    /** Formata R$ e parte contrária para evidência de um processo */
    function processoEvidence(p) {
      const items = [];
      if (p.numeroProcesso) items.push({ label: "Número", value: p.numeroProcesso });
      if (p.ano) items.push({ label: "Ano", value: p.ano });
      if (p.classe?.nome) items.push({ label: "Classe", value: p.classe.nome });
      if (p.valor != null) {
        const brl = Number(p.valor).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
        items.push({ label: "Valor da causa", value: brl });
      }
      if (p.polo) items.push({ label: "Polo da empresa", value: p.polo === "ATIVO" ? "Autora" : "Ré" });
      if (p.parteContraria?.length > 0) {
        items.push({ label: "Parte contrária", value: p.parteContraria.join("; ") });
      }
      if (p.orgaoJulgador?.nome) items.push({ label: "Órgão julgador", value: p.orgaoJulgador.nome });
      return items;
    }

    if (byType.criminal.length > 0) {
      const sample = byType.criminal[0];
      const totalValor = byType.criminal.reduce((s, p) => s + (Number(p.valor) || 0), 0);
      flags.push({
        id: "datajud_processos_criminais",
        source_id: "datajud",
        source: "DataJud (CNJ)",
        severity: "critical",
        title: `Empresa em ${byType.criminal.length} processo(s) criminal(is)`,
        description:
          `Foram encontrados ${byType.criminal.length} processo(s) de natureza criminal ou de improbidade ` +
          `nos tribunais consultados via DataJud/CNJ.`,
        weight: 35,
        evidence: [
          ...evidenceBase,
          { label: "Processos criminais", value: String(byType.criminal.length) },
          ...(totalValor > 0
            ? [{ label: "Valor total (soma)", value: totalValor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) }]
            : []),
          ...processoEvidence(sample),
        ],
      });
    }

    if (byType.fiscal.length > 0) {
      const sample = byType.fiscal[0];
      const totalValor = byType.fiscal.reduce((s, p) => s + (Number(p.valor) || 0), 0);
      flags.push({
        id: "datajud_execucoes_fiscais",
        source_id: "datajud",
        source: "DataJud (CNJ)",
        severity: "high",
        title: `Empresa em ${byType.fiscal.length} execução(ões) fiscal(is)`,
        description:
          `Foram encontrados ${byType.fiscal.length} processo(s) de execução fiscal ou cobrança de dívida ` +
          `nos tribunais consultados via DataJud/CNJ.`,
        weight: 20,
        evidence: [
          ...evidenceBase,
          { label: "Execuções fiscais", value: String(byType.fiscal.length) },
          ...(totalValor > 0
            ? [{ label: "Valor total (soma)", value: totalValor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) }]
            : []),
          ...processoEvidence(sample),
        ],
      });
    }

    if (byType.trabalhista.length > 0) {
      const sample = byType.trabalhista[0];
      const totalValor = byType.trabalhista.reduce((s, p) => s + (Number(p.valor) || 0), 0);
      flags.push({
        id: "datajud_processos_trabalhistas",
        source_id: "datajud",
        source: "DataJud (CNJ)",
        severity: byType.trabalhista.length >= 5 ? "high" : "medium",
        title: `Empresa em ${byType.trabalhista.length} processo(s) trabalhista(s)`,
        description:
          `Foram encontrados ${byType.trabalhista.length} processo(s) trabalhista(s) ` +
          `nos tribunais consultados via DataJud/CNJ.`,
        weight: byType.trabalhista.length >= 5 ? 15 : 8,
        evidence: [
          ...evidenceBase,
          { label: "Processos trabalhistas", value: String(byType.trabalhista.length) },
          ...(totalValor > 0
            ? [{ label: "Valor total (soma)", value: totalValor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) }]
            : []),
          ...processoEvidence(sample),
        ],
      });
    }

    if (byType.falencia.length > 0) {
      const sample = byType.falencia[0];
      const totalValor = byType.falencia.reduce((s, p) => s + (Number(p.valor) || 0), 0);
      flags.push({
        id: "datajud_falencia",
        source_id: "datajud",
        source: "DataJud (CNJ)",
        severity: "critical",
        title: `Empresa com processo de FALÊNCIA`,
        description:
          `Foram encontrados ${byType.falencia.length} processo(s) de falência ou insolvência ` +
          `nos tribunais consultados via DataJud/CNJ. Risco máximo de continuidade operacional.`,
        weight: 50,
        evidence: [
          ...evidenceBase,
          { label: "Processos de falência", value: String(byType.falencia.length) },
          ...(totalValor > 0
            ? [{ label: "Valor total (soma)", value: totalValor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) }]
            : []),
          ...processoEvidence(sample),
        ],
      });
    }

    if (byType.recuperacao.length > 0) {
      const sample = byType.recuperacao[0];
      const totalValor = byType.recuperacao.reduce((s, p) => s + (Number(p.valor) || 0), 0);
      flags.push({
        id: "datajud_recuperacao_judicial",
        source_id: "datajud",
        source: "DataJud (CNJ)",
        severity: "critical",
        title: `Empresa em RECUPERAÇÃO JUDICIAL`,
        description:
          `Foram encontrados ${byType.recuperacao.length} processo(s) de recuperação judicial ` +
          `nos tribunais consultados via DataJud/CNJ. Alto risco de inadimplência e descontinuidade.`,
        weight: 40,
        evidence: [
          ...evidenceBase,
          { label: "Processos de recuperação", value: String(byType.recuperacao.length) },
          ...(totalValor > 0
            ? [{ label: "Valor total (soma)", value: totalValor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) }]
            : []),
          ...processoEvidence(sample),
        ],
      });
    }

    if (total > 0 && flags.length === 0) {
      const sample = result.processes[0];
      flags.push({
        id: "datajud_processos_civeis",
        source_id: "datajud",
        source: "DataJud (CNJ)",
        severity: total >= 10 ? "medium" : "low",
        title: `Empresa com ${total} processo(s) judicial(is)`,
        description: `Foram encontrados ${total} processo(s) nos tribunais consultados via DataJud/CNJ.`,
        weight: total >= 10 ? 10 : 5,
        evidence: [
          ...evidenceBase,
          ...(sample ? processoEvidence(sample) : []),
        ],
      });
    }

    // Flag de carga judicial alta: volume elevado de processos de múltiplos tipos
    if (total >= 20 && flags.length >= 2) {
      flags.push({
        id: "datajud_carga_judicial_alta",
        source_id: "datajud",
        source: "DataJud (CNJ)",
        severity: "high",
        title: `Carga judicial elevada: ${total} processos em múltiplas categorias`,
        description:
          `Volume total de ${total} processos judiciais com ocorrências em múltiplas categorias ` +
          `(criminal, fiscal, trabalhista). Indicativo de litigiosidade sistêmica.`,
        weight: 10,
        evidence: [
          ...evidenceBase,
          { label: "Criminais", value: String(byType.criminal.length) },
          { label: "Fiscais", value: String(byType.fiscal.length) },
          { label: "Trabalhistas", value: String(byType.trabalhista.length) },
          { label: "Cíveis/outros", value: String(byType.civil.length + byType.outro.length) },
        ],
      });
    }

    return {
      source: buildSourceStatus("datajud", total > 0 ? "success" : "not_found", {
        latencyMs: Date.now() - start,
        statusReason: total > 0 ? "match_found" : (result.statusReason ?? "not_listed"),
        evidenceCount: total,
        message:
          total === 0 && result.errorSummary
            ? `Cobertura parcial no DataJud (${result.errorSummary})`
            : undefined,
      }),
      flags,
      // Processos estruturados — passados via spread para o retorno da API
      processes: (result.processes ?? []).map((process) => ({
        ...process,
        tipo: classifyProcesso(process),
        classe_cnj: process?.classe?.codigo ?? null,
        assunto_cnj:
          Array.isArray(process?.assuntos) && process.assuntos.length > 0
            ? process.assuntos[0]?.codigo ?? null
            : null,
        valor_causa: process?.valor ?? null,
        data_distribuicao: process?.dataAjuizamento ?? null,
        polo_ativo_nome:
          Array.isArray(process?.partes)
            ? (process.partes.find((item) => String(item?.polo ?? "").toLowerCase().includes("ativo"))?.nome ?? null)
            : null,
      })),
    };
  });
}

function isSyncDatajudEnabled() {
  return parseBooleanEnv(process.env.FEATURE_DATAJUD_SYNC_ANALYZE, true);
}

// ─────────────────────────────────────────────────────────────────────────────
// Agente 3 melhorado — Sócios PF com CPF mascarado: busca por nome + desambiguação
// ─────────────────────────────────────────────────────────────────────────────

async function queryPFByNameCGU(sourceId, endpoint, queryParamName, name) {
  if (!PORTAL_TRANSPARENCIA_API_KEY) return [];
  const source = getSourceConfig(sourceId);
  try {
    const response = await fetchWithTimeout(
      `https://api.portaldatransparencia.gov.br/api-de-dados/${endpoint}?${queryParamName}=${encodeURIComponent(name)}&pagina=1`,
      source.timeoutMs,
      { headers: { "chave-api-dados": PORTAL_TRANSPARENCIA_API_KEY, accept: "application/json" } },
    );
    if (!response || !response.ok) return [];
    const payload = await response.json();
    return Array.isArray(payload) ? payload : [];
  } catch {
    return [];
  }
}

async function queryPFByName(partnerProfile) {
  const { nome } = partnerProfile;
  if (!nome) return { matches: [] };

  const [ceisRecords, cnepRecords, ceafRecords] = await Promise.all([
    queryPFByNameCGU("cgu_ceis", "ceis", "nomeSancionado", nome).catch(() => []),
    queryPFByNameCGU("cgu_cnep", "cnep", "nomeSancionado", nome).catch(() => []),
    queryPFByNameCGU("cgu_ceaf", "ceaf", "nomeSancionado", nome).catch(() => []),
  ]);

  const rawMatches = [];

  for (const record of ceisRecords) {
    const result = {
      nome: record.sancionado?.nome ?? record.pessoa?.nome ?? record.nome ?? "",
      cpf: record.sancionado?.cpfCnpj ?? record.pessoa?.cpfCnpj ?? "",
      uf: record.uf ?? "",
    };
    const disambig = calculateDisambiguationScore(partnerProfile, result);
    if (disambig.level !== "DESCARTADO") {
      rawMatches.push({ ...disambig, source: "CEIS", flag_title: "Sanção no CEIS", record });
    }
  }

  for (const record of cnepRecords) {
    const result = {
      nome: record.sancionado?.nome ?? record.pessoa?.nome ?? record.nome ?? "",
      cpf: record.sancionado?.cpfCnpj ?? record.pessoa?.cpfCnpj ?? "",
      uf: record.uf ?? "",
    };
    const disambig = calculateDisambiguationScore(partnerProfile, result);
    if (disambig.level !== "DESCARTADO") {
      rawMatches.push({ ...disambig, source: "CNEP", flag_title: "Penalidade no CNEP", record });
    }
  }

  for (const record of ceafRecords) {
    const result = {
      nome: record.nome ?? record.sancionado?.nome ?? "",
      cpf: record.cpf ?? record.sancionado?.cpfCnpj ?? "",
      uf: record.uf ?? "",
    };
    const disambig = calculateDisambiguationScore(partnerProfile, result);
    if (disambig.level !== "DESCARTADO") {
      rawMatches.push({ ...disambig, source: "CEAF", flag_title: "Expulsão no CEAF", record });
    }
  }

  const withConvergence = applyConvergenceBonus(rawMatches);
  return { matches: withConvergence };
}

async function queryPartnerCompaniesByCnpj(partners) {
  const partnerEntries = partners
    .filter((partner) => partner?.tipo === "PJ")
    .map((partner) => ({
      partnerName: String(partner?.nome ?? "").trim(),
      cnpj: cleanDocument(partner?.cnpj_cpf_do_socio ?? ""),
    }))
    .filter((entry) => entry.cnpj.length === 14);

  const deduped = [];
  const seen = new Set();
  for (const entry of partnerEntries) {
    if (seen.has(entry.cnpj)) continue;
    seen.add(entry.cnpj);
    deduped.push(entry);
  }

  if (deduped.length === 0) {
    return {
      source: "BrasilAPI",
      status: "not_found",
      message: "Nenhum sócio PJ com CNPJ completo no QSA.",
      items: [],
    };
  }

  const lookupLimit = Number.parseInt(process.env.PARTNER_PJ_LOOKUP_LIMIT ?? "12", 10);
  const scoped = deduped.slice(0, Math.max(1, lookupLimit));

  const lookups = await mapWithConcurrency(scoped, 2, async (entry) => {
    const [response, risk] = await Promise.all([
      fetchWithTimeout(`https://brasilapi.com.br/api/cnpj/v1/${entry.cnpj}`, 12000),
      analyzePartnerRisk(entry.cnpj),
    ]);

    if (!response || !response.ok) {
      return { ...entry, status: "error", company: null, risk };
    }

    const payload = await response.json();
    return { ...entry, status: "success", company: payload, risk };
  });

  const successItems = lookups
    .filter((lookup) => lookup.status === "success" && lookup.company && typeof lookup.company === "object")
    .map((lookup) => ({
      partner_name: lookup.partnerName,
      cnpj: lookup.cnpj,
      razao_social: lookup.company.razao_social ?? "",
      nome_fantasia: lookup.company.nome_fantasia ?? "",
      situacao_cadastral: lookup.company.descricao_situacao_cadastral ?? "",
      uf: lookup.company.uf ?? "",
      municipio: lookup.company.municipio ?? "",
      data_inicio_atividade: lookup.company.data_inicio_atividade ?? "",
      cep: lookup.company.cep ?? "",
      risk_flags: lookup.risk?.risk_flags ?? [],
      risk_score: lookup.risk?.risk_score ?? 0,
      risk_classification: lookup.risk?.risk_classification ?? "Baixo",
    }));

  const failedCount = lookups.length - successItems.length;
  return {
    source: "BrasilAPI",
    status: successItems.length > 0 ? "success" : "unavailable",
    message:
      failedCount > 0
        ? `${failedCount} consulta(s) de sócio PJ não retornaram dados no momento.`
        : undefined,
    items: successItems,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Agente 4 — Padrões de rede (spec Agent 7 simplificado)
// ─────────────────────────────────────────────────────────────────────────────

function detectNetworkPatterns(company, partnerCompanies) {
  const flags = [];

  // EMPRESA_RECENTE: início de atividade < 1 ano
  if (company.data_inicio_atividade) {
    const startDate = new Date(company.data_inicio_atividade);
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    if (!Number.isNaN(startDate.getTime()) && startDate > oneYearAgo) {
      flags.push({
        id: "network_empresa_recente",
        source: "Análise Estrutural",
        severity: "medium",
        title: "Empresa recente (menos de 1 ano)",
        description: `A empresa tem menos de 1 ano de atividade (início: ${company.data_inicio_atividade}).`,
        weight: 10,
        depth: 0,
        evidence: [{ label: "Início de atividade", value: company.data_inicio_atividade }],
      });
    }
  }

  // POSSIVEL_LARANJA: capital < R$1.000 + empresa recente + sócio único
  const isRecent = flags.some((f) => f.id === "network_empresa_recente");
  const capitalBaixo = (company.capital_social ?? 0) < 1000;
  const socioUnico = Array.isArray(company.qsa) && company.qsa.length === 1;
  if (capitalBaixo && isRecent && socioUnico) {
    flags.push({
      id: "network_possivel_laranja",
      source: "Análise Estrutural",
      severity: "high",
      title: "Perfil de empresa de fachada (heurística)",
      description:
        "Capital social abaixo de R$1.000, empresa recente e sócio único — padrão consistente com empresa fictícia ou laranja.",
      weight: 20,
      depth: 0,
      evidence: [
        { label: "Capital Social", value: `R$ ${company.capital_social ?? 0}` },
        { label: "Sócios", value: String(company.qsa?.length ?? 0) },
      ],
    });
  }

  // MESMO_ENDERECO_REDE: 2+ empresas parceiras com mesmo CEP
  const items = partnerCompanies?.items ?? [];
  if (items.length >= 2) {
    const cepMap = new Map();
    for (const item of items) {
      const cep = (item.cep ?? "").replace(/\D/g, "");
      if (!cep || cep.length !== 8) continue;
      const group = cepMap.get(cep) ?? [];
      group.push(item.razao_social || item.cnpj);
      cepMap.set(cep, group);
    }
    for (const [cep, companies] of cepMap.entries()) {
      if (companies.length >= 2) {
        flags.push({
          id: "network_mesmo_endereco_rede",
          source: "Análise Estrutural",
          severity: "medium",
          title: "Múltiplos sócios PJ no mesmo endereço (CEP)",
          description: `${companies.length} empresas parceiras concentradas no mesmo CEP ${cep}: ${companies.slice(0, 3).join(", ")}.`,
          weight: 15,
          depth: 0,
          evidence: [
            { label: "CEP comum", value: cep },
            { label: "Empresas no CEP", value: companies.slice(0, 3).join(", ") },
          ],
        });
      }
    }
  }

  return flags;
}

function buildCompany(receitaData, cleanCnpj) {
  const qsaEntries = Array.isArray(receitaData.qsa) ? receitaData.qsa : [];
  const qsa = qsaEntries.map((entry) => {
    const socioType = entry.identificador_de_socio === 1 ? "PJ" : "PF";
    return {
      nome: entry.nome_socio || entry.nome || "",
      qual: entry.qualificacao_socio || entry.qual || "",
      pais_origem: entry.pais_origem || "BRASIL",
      nome_rep_legal: entry.nome_representante_legal || entry.nome_rep_legal || "",
      qual_rep_legal: entry.qualificacao_representante_legal || entry.qual_rep_legal || "",
      faixa_etaria: entry.faixa_etaria || "",
      cnpj_cpf_do_socio: entry.cnpj_cpf_do_socio || "",
      tipo: socioType,
    };
  });

  return {
    cnpj: cleanCnpj,
    razao_social: receitaData.razao_social || "",
    nome_fantasia: receitaData.nome_fantasia || "",
    situacao_cadastral: receitaData.descricao_situacao_cadastral || "Desconhecida",
    data_situacao_cadastral: receitaData.data_situacao_cadastral || "",
    data_inicio_atividade: receitaData.data_inicio_atividade || "",
    cnae_fiscal: toNumber(receitaData.cnae_fiscal),
    cnae_fiscal_descricao: receitaData.cnae_fiscal_descricao || "",
    logradouro: receitaData.logradouro || "",
    numero: receitaData.numero || "",
    complemento: receitaData.complemento || "",
    bairro: receitaData.bairro || "",
    cep: receitaData.cep || "",
    municipio: receitaData.municipio || "",
    uf: receitaData.uf || "",
    natureza_juridica: receitaData.natureza_juridica || "",
    porte: receitaData.porte || "",
    capital_social: toNumber(receitaData.capital_social),
    qsa,
  };
}

function generateSummary(classification, flags, companyName) {
  if (flags.length === 0) {
    return `A empresa ${companyName} não apresenta registros negativos nas bases consultadas. Risco considerado baixo.`;
  }

  const flagSummary = flags.map((flag) => flag.title).join(", ");
  const recommendations = {
    Baixo: "Monitoramento periódico recomendado.",
    Médio: "Recomenda-se análise aprofundada antes de prosseguir com a contratação.",
    Alto: "Alto risco identificado. Recomenda-se cautela extrema e due diligence completa.",
    Crítico: "RISCO CRÍTICO. Recomenda-se NÃO prosseguir com a contratação sem análise jurídica detalhada.",
  };

  return `A empresa ${companyName} apresenta ${flags.length} alerta(s): ${flagSummary}. ${recommendations[classification] || ""}`;
}

/**
 * @param {string} cnpj
 */
export async function analyzeCnpj(cnpj) {
  const cleanCnpj = cleanDocument(cnpj);
  if (cleanCnpj.length !== 14) {
    throw new HttpError(400, "CNPJ inválido");
  }

  let pgfnSnapshotAt = null;
  try {
    pgfnSnapshotAt = await getLatestSnapshotAt(PGFN_SOURCE_IDS);
  } catch {
    pgfnSnapshotAt = null;
  }

  const [
    receitaResult,
    ceisResult,
    cnepResult,
    cepimResult,
    tcuResult,
    mteResult,
    mteAutuacoesResult,
    pgfnFgtsResult,
    pgfnPrevidResult,
    pgfnNpResult,
    acordosResult,
  ] = await Promise.all([
    queryReceitaFederal(cleanCnpj),
    queryCEIS(cleanCnpj),
    queryCNEP(cleanCnpj),
    queryCEPIM(cleanCnpj),
    queryTCULicitantes(cleanCnpj),
    queryMTETrabalhoEscravo(cleanCnpj),
    queryMTEAutuacoes(cleanCnpj),
    queryPGFNIndexed("pgfn_fgts", cleanCnpj, {
      flagId: "pgfn_fgts_divida_ativa",
      severity: "medium",
      weight: 15,
      title: "Empresa com inscrição em dívida ativa (FGTS)",
      description:
        "A empresa consta em dados abertos de inscrições em dívida ativa vinculadas ao FGTS na PGFN.",
    }),
    queryPGFNIndexed("pgfn_previdenciario", cleanCnpj, {
      flagId: "pgfn_previd_divida_ativa",
      severity: "medium",
      weight: 15,
      title: "Empresa com inscrição em dívida ativa previdenciária",
      description: "A empresa consta em dados abertos de dívida ativa previdenciária da PGFN.",
    }),
    queryPGFNIndexed("pgfn_nao_previdenciario", cleanCnpj, {
      flagId: "pgfn_np_divida_ativa",
      severity: "medium",
      weight: 20,
      title: "Empresa com inscrição em dívida ativa não-previdenciária",
      description: "A empresa consta em dados abertos de dívida ativa não-previdenciária (tributos federais) da PGFN.",
    }),
    queryAcordosLeniencia(cleanCnpj),
  ]);

  const flags = [];
  const sources = [];

  const receitaData = receitaResult.receitaData ?? null;
  sources.push(receitaResult.source);

  if (receitaData && receitaData.situacao_cadastral !== undefined && receitaData.situacao_cadastral !== 2) {
    flags.push(withVerificationStatus({
      id: "receita_situacao",
      source: "Receita Federal",
      severity: "high",
      title: "Situação cadastral irregular",
      description: `Empresa com situação cadastral: ${receitaData.descricao_situacao_cadastral || "Irregular"}`,
      weight: 30,
      evidence: [
        { label: "Situação cadastral", value: receitaData.descricao_situacao_cadastral || "Irregular" },
      ],
    }));
  }

  const firstStageResults = [
    ceisResult,
    cnepResult,
    cepimResult,
    tcuResult,
    mteResult,
    mteAutuacoesResult,
    pgfnFgtsResult,
    pgfnPrevidResult,
    pgfnNpResult,
    acordosResult,
  ];

  for (const result of firstStageResults) {
    sources.push(result.source);
    flags.push(...result.flags.map(withVerificationStatus));
  }

  if (!receitaData) {
    throw new HttpError(404, "Não foi possível obter dados da empresa. Verifique o CNPJ.");
  }

  const company = buildCompany(receitaData, cleanCnpj);

  // Identifica sócios PF com CPF mascarado para busca por nome (Agente 3 melhorado)
  const pfPartners = company.qsa.filter((partner) => partner?.tipo === "PF");
  const pfCpfFullCount = pfPartners.filter((partner) => cleanDocument(partner?.cnpj_cpf_do_socio ?? "").length === 11).length;
  const pfCpfMaskedCount = pfPartners.length - pfCpfFullCount;

  const maskedPfPartners = pfPartners
    .filter((p) => cleanDocument(p.cnpj_cpf_do_socio ?? "").length !== 11 && p.nome)
    .slice(0, 10) // Limita a 10 para evitar sobrecarga
    .map((p) => ({
      nome: normalizePersonName(p.nome),
      cpf_masked: p.cnpj_cpf_do_socio,
      uf: company.uf,
      municipio: company.municipio,
      partner_name: p.nome,
    }));

  const shouldRunDatajudSync = isSyncDatajudEnabled() && isDatajudEnabled();

  // Agentes 2, 3 (completo e por nome), CEAF, Servidores, TCU Eleitoral e DataJud — em paralelo
  const [eleitoralResult, ceafResult, servidoresResult, partnerCompanies, pfNameResultsAll, datajudResult] =
    await Promise.all([
      queryTCUEleitoral(company.qsa),
      queryCEAF(company.qsa),
      queryServidoresFederais(company.qsa),
      queryPartnerCompaniesByCnpj(company.qsa),
      Promise.all(
        maskedPfPartners.map((profile) =>
          queryPFByName(profile).catch(() => ({ matches: [] })),
        ),
      ),
      shouldRunDatajudSync ? queryDatajud(cleanCnpj, company) : Promise.resolve(null),
    ]);

  for (const result of [eleitoralResult, ceafResult, servidoresResult]) {
    sources.push(result.source);
    flags.push(...result.flags.map(withVerificationStatus));
  }
  if (datajudResult) {
    sources.push(datajudResult.source);
    flags.push(...(Array.isArray(datajudResult.flags) ? datajudResult.flags : []).map(withVerificationStatus));
  }

  // Processa resultados de nome de sócios PF mascarados (Agente 3)
  const pfPartnerResults = maskedPfPartners.map((profile, i) => ({
    partner_name: profile.partner_name,
    matches: pfNameResultsAll[i]?.matches ?? [],
  }));

  // Gera flags de confidence a partir dos matches por nome
  for (const pfResult of pfPartnerResults) {
    const validMatches = (pfResult.matches ?? []).filter(
      (m) => m.level !== "DESCARTADO" && m.level !== "HOMONIMO_CERTO",
    );
    for (const match of validMatches) {
      const severity =
        match.level === "CONFIRMADO" ? "critical" : match.level === "PROVAVEL" ? "high" : "medium";
      const weight =
        match.level === "CONFIRMADO" ? 30 : match.level === "PROVAVEL" ? 21 : 9;
      const safeName = normalizePersonName(pfResult.partner_name)
        .replace(/\s+/g, "_")
        .substring(0, 20);
      flags.push(withVerificationStatus({
        id: `pf_name_${match.source.toLowerCase()}_${safeName}`,
        source: `${match.source} (busca por nome)`,
        severity,
        title: `Sócio possivelmente listado no ${match.source}`,
        description: `${pfResult.partner_name} pode constar no ${match.source}. Validação por nome (CPF mascarado na Receita).`,
        weight,
        confidence: match.score,
        confidence_level: match.level,
        verification_status: match.level === "POSSIVEL" ? "possible" : "probable",
        depth: 0,
        evidence: [
          { label: "Sócio investigado", value: pfResult.partner_name },
          { label: "Nível de confiança", value: `${match.level} (score: ${(match.score ?? 0).toFixed(2)})` },
          { label: "Fonte de busca", value: match.source },
        ],
      }));
    }
  }

  // Agente 4 — Padrões de rede
  const networkFlags = detectNetworkPatterns(company, partnerCompanies);
  flags.push(...networkFlags.map(withVerificationStatus));

  // Agente 2b — Rede societária depth=2 (opcional, FEATURE_DEEP_NETWORK=true)
  if (isDeepNetworkEnabled()) {
    const depth2Flags = await analyzeDepth2Network(partnerCompanies?.items ?? []);
    flags.push(...depth2Flags.map(withVerificationStatus));
  }

  const { score, classification, top_risks } = calculateScore(flags);
  const subscores = calculateSubscores(flags);
  const score_explanation = { top_risks };
  const summary = generateSummary(classification, flags, company.razao_social);
  const partial = sources.some((source) => source.status === "error" || source.status === "unavailable");

  // GenAI só deve ser executado após a investigação profunda (crawler + enriquecimento).
  let aiAnalysis = {
    available: false,
    reason: "Laudo GenAI pendente: aguardando conclusão da investigação profunda.",
  };

  let deepInvestigation = {
    run_id: null,
    status: "failed",
    auto_started: false,
  };
  let judicialScan = {
    run_id: null,
    status: "failed",
    consulted: 0,
    supported: 0,
    unavailable: 0,
    found_processes: 0,
  };
  try {
    const scheduled = await enqueueDeepInvestigation({
      cnpj: cleanCnpj,
      company,
      flags,
      sources,
      sourcesVersion: SOURCES_VERSION,
      snapshotAt: pgfnSnapshotAt,
    });
    if (scheduled) {
      deepInvestigation = scheduled;
      judicialScan = {
        run_id: scheduled.run_id,
        status: scheduled.status,
        consulted: 0,
        supported: 0,
        unavailable: 0,
        found_processes: 0,
      };
    }
  } catch (error) {
    console.error("[deep-investigation] schedule failed:", error instanceof Error ? error.message : error);
  }

  if (!deepInvestigation.run_id) {
    aiAnalysis = await generateIntelligenceReport({
      company,
      flags,
      sources,
      score,
      classification,
      subscores,
      score_explanation,
      partnerCompanies,
      pfPartnerResults,
    }).catch((e) => {
      console.error("[ai-synthesis] unexpected error:", e.message);
      return { available: false, reason: "Erro interno na síntese IA" };
    });
  } else {
    aiAnalysis = {
      available: false,
      reason: `Laudo GenAI pendente: investigação em andamento (run_id: ${deepInvestigation.run_id}).`,
    };
  }

  if (!datajudResult) {
    sources.push(
      buildSourceStatus(
        "datajud",
        deepInvestigation.run_id ? "running" : "unavailable",
        {
          latencyMs: 0,
          evidenceCount: 0,
          statusReason: deepInvestigation.run_id ? "deferred_to_crawler" : "not_scheduled",
          message: deepInvestigation.run_id
            ? `DataJud será executado para enriquecimento via crawler (run_id: ${deepInvestigation.run_id})`
            : "DataJud não executado nesta etapa",
        },
      ),
    );
  }

  sources.push(
    buildSourceStatus(
      "judicial_crawler",
      deepInvestigation.run_id ? "running" : "unavailable",
      {
        latencyMs: 0,
        evidenceCount: 0,
        statusReason: deepInvestigation.run_id ? "queued_async" : "not_scheduled",
        message: deepInvestigation.run_id
          ? `Varredura assíncrona iniciada (run_id: ${deepInvestigation.run_id})`
          : "Varredura judicial não foi agendada",
      },
    ),
  );

  return {
    company,
    score,
    classification,
    subscores,
    score_explanation,
    flags,
    sources,
    summary,
    analyzed_at: new Date().toISOString(),
    meta: {
      sources_version: SOURCES_VERSION,
      partial,
      snapshot_at: pgfnSnapshotAt,
      deep_investigation: deepInvestigation,
      judicial_scan: judicialScan,
    },
    ai_analysis: aiAnalysis,
    judicial_processes: Array.isArray(datajudResult?.processes) ? datajudResult.processes : [],
    related_entities: {
      partner_companies: partnerCompanies,
      graph: deepInvestigation.run_id
        ? {
            run_id: deepInvestigation.run_id,
            status: deepInvestigation.status,
          }
        : undefined,
      pf_reverse_lookup: {
        status: deepInvestigation.run_id ? "running" : "unavailable",
        checked_pf_partners: pfPartners.length,
        cpf_full_count: pfCpfFullCount,
        cpf_masked_count: Math.max(0, pfCpfMaskedCount),
        methods: ["bigquery", "brasilio_socios_brasil"],
        run_id: deepInvestigation.run_id ?? null,
        message:
          "Mapeamento PF->PJ é executado na investigação profunda (run assíncrona), com BigQuery quando configurado e fallback por nome+CPF mascarado na base socios-brasil (Brasil.io).",
      },
    },
  };
}
