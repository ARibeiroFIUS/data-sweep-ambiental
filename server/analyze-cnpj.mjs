import {
  cleanDocument,
  mapWithConcurrency,
  normalizePersonName,
  parseDelimitedLine,
  resolveHeaderIndexAny,
  toNumber,
} from "./common-utils.mjs";
import { fetchWithTimeout } from "./http-utils.mjs";
import { getIndexedSourceMatch, getLatestSnapshotAt, isSourceIndexStoreEnabled } from "./source-index-store.mjs";
import { getSourceConfig, isSourceEnabled, PGFN_SOURCE_IDS, SOURCES_VERSION } from "./source-registry.mjs";
import { calculateScore } from "./risk-scoring.mjs";

const PORTAL_TRANSPARENCIA_API_KEY = (process.env.PORTAL_TRANSPARENCIA_API_KEY ?? "").trim();
const SOCIO_CPF_QUERY_LIMIT = Number.parseInt(process.env.SOCIO_CPF_QUERY_LIMIT ?? "25", 10);
const SOCIO_CPF_CONCURRENCY = Number.parseInt(process.env.SOCIO_CPF_CONCURRENCY ?? "4", 10);

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
  } catch {
    return {
      source: buildSourceStatus(sourceId, "error", {
        latencyMs: Date.now() - start,
        statusReason: "unhandled_exception",
        message: "Erro inesperado ao processar a fonte",
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
    const response = await fetchWithTimeout(url, source.timeoutMs, {
      headers: {
        "chave-api-dados": PORTAL_TRANSPARENCIA_API_KEY,
        accept: "application/json",
      },
    });

    if (!response) {
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

    if (response.status === 401 || response.status === 403) {
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

    if (response.status === 429) {
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

    if (!response.ok) {
      return {
        source: buildSourceStatus(sourceId, "error", {
          latencyMs: Date.now() - start,
          statusReason: `http_${response.status}`,
          message: "Falha ao consultar API da Transparência",
        }),
        flags: [],
        data: null,
      };
    }

    const payload = await response.json();
    const records = Array.isArray(payload) ? payload : [];

    return {
      source: buildSourceStatus(sourceId, records.length > 0 ? "success" : "not_found", {
        latencyMs: Date.now() - start,
        statusReason: records.length > 0 ? "match_found" : "not_listed",
        evidenceCount: records.length,
      }),
      flags: [],
      data: records,
    };
  });
}

async function queryCEIS(cnpj) {
  const result = await queryCGUByCnpj("cgu_ceis", "ceis", "cnpjSancionado", cnpj);

  if (result.source.status !== "success") return result;

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
      },
    ],
  };
}

async function queryCNEP(cnpj) {
  const result = await queryCGUByCnpj("cgu_cnep", "cnep", "cnpjSancionado", cnpj);

  if (result.source.status !== "success") return result;

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
      },
    ],
  };
}

async function queryCEPIM(cnpj) {
  const result = await queryCGUByCnpj("cgu_cepim", "cepim", "cnpjSancionado", cnpj);

  if (result.source.status !== "success") return result;

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
      },
    ],
  };
}

async function queryAcordosLeniencia(cnpj) {
  const result = await queryCGUByCnpj("cgu_acordos_leniencia", "acordos-leniencia", "cnpjSancionado", cnpj);

  if (result.source.status !== "success") return result;

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
        },
      ],
    };
  });
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
  const response = await fetchWithTimeout(
    `https://api.portaldatransparencia.gov.br/api-de-dados/${endpoint}?${queryParamName}=${cpf}&pagina=1`,
    source.timeoutMs,
    {
      headers: {
        "chave-api-dados": PORTAL_TRANSPARENCIA_API_KEY,
        accept: "application/json",
      },
    },
  );

  if (!response) return { type: "unavailable", records: [] };
  if (response.status === 401 || response.status === 403) return { type: "unavailable", records: [] };
  if (!response.ok) return { type: "error", records: [] };

  const payload = await response.json();
  return {
    type: "success",
    records: Array.isArray(payload) ? payload : [],
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
    flagFactory: ({ matchedCount, partnerNames, maskedCount }) => {
      const namesText = partnerNames.length > 0 ? ` Exemplos: ${partnerNames.join(", ")}.` : "";
      const maskedText =
        maskedCount > 0
          ? ` ${maskedCount} CPF(s) mascarado(s) na Receita/BrasilAPI não foram verificáveis.`
          : "";

      return {
        id: "cgu_ceaf_socio_expulso",
        source: "CGU",
        severity: "high",
        title: "Sócio listado no CEAF",
        description: `${matchedCount} sócio(s) constam no CEAF como expulsos da Administração Federal.${namesText}${maskedText}`,
        weight: 25,
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
    flagFactory: ({ matchedCount, partnerNames }) => {
      const namesText = partnerNames.length > 0 ? ` Exemplos: ${partnerNames.join(", ")}.` : "";

      return {
        id: "cgu_socio_servidor_federal",
        source: "CGU",
        severity: "medium",
        title: "Sócio identificado como servidor federal",
        description: `${matchedCount} sócio(s) identificados como servidor público federal ativo — possível conflito de interesse.${namesText}`,
        weight: 10,
      };
    },
  });
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
    flags.push({
      id: "receita_situacao",
      source: "Receita Federal",
      severity: "high",
      title: "Situação cadastral irregular",
      description: `Empresa com situação cadastral: ${receitaData.descricao_situacao_cadastral || "Irregular"}`,
      weight: 30,
    });
  }

  const firstStageResults = [
    ceisResult,
    cnepResult,
    cepimResult,
    tcuResult,
    mteResult,
    pgfnFgtsResult,
    pgfnPrevidResult,
    pgfnNpResult,
    acordosResult,
  ];

  for (const result of firstStageResults) {
    sources.push(result.source);
    flags.push(...result.flags);
  }

  if (!receitaData) {
    throw new HttpError(404, "Não foi possível obter dados da empresa. Verifique o CNPJ.");
  }

  const company = buildCompany(receitaData, cleanCnpj);

  const [eleitoralResult, ceafResult, servidoresResult] = await Promise.all([
    queryTCUEleitoral(company.qsa),
    queryCEAF(company.qsa),
    queryServidoresFederais(company.qsa),
  ]);

  for (const result of [eleitoralResult, ceafResult, servidoresResult]) {
    sources.push(result.source);
    flags.push(...result.flags);
  }

  const { score, classification } = calculateScore(flags);
  const summary = generateSummary(classification, flags, company.razao_social);

  const partial = sources.some((source) => source.status === "error" || source.status === "unavailable");

  return {
    company,
    score,
    classification,
    flags,
    sources,
    summary,
    analyzed_at: new Date().toISOString(),
    meta: {
      sources_version: SOURCES_VERSION,
      partial,
      snapshot_at: pgfnSnapshotAt,
    },
  };
}
