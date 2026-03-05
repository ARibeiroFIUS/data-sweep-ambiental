import { fetchWithTimeout } from "./http-utils.mjs";
import { getSourceConfig, isSourceEnabled } from "./source-registry.mjs";

const BRASILAPI_BASE_URL = (process.env.BRASILAPI_BASE_URL ?? "https://brasilapi.com.br").trim().replace(/\/$/, "");
const OPENCNPJ_BASE_URL = (process.env.OPENCNPJ_BASE_URL ?? "https://api.opencnpj.org").trim().replace(/\/$/, "");
const OPENCNPJ_API_KEY = (process.env.OPENCNPJ_API_KEY ?? process.env.OPENCNPJ_API_TOKEN ?? "").trim();
const RECEITAWS_BASE_URL = (process.env.RECEITAWS_BASE_URL ?? "https://receitaws.com.br").trim().replace(/\/$/, "");
const RECEITAWS_API_TOKEN = (process.env.RECEITAWS_API_TOKEN ?? "").trim();
const PORTAL_TRANSPARENCIA_API_KEY = (process.env.PORTAL_TRANSPARENCIA_API_KEY ?? "").trim();
const OPENAI_API_KEY = (process.env.OPENAI_API_KEY ?? "").trim();
const OPENAI_MODEL = (process.env.OPENAI_MODEL ?? "gpt-4o-mini").trim();
const OPENAI_FTE_MODEL = (process.env.OPENAI_FTE_MODEL ?? OPENAI_MODEL ?? "gpt-4o-mini").trim();
const OPENAI_FTE_VECTOR_STORE_ID = (
  process.env.OPENAI_FTE_VECTOR_STORE_ID ??
  process.env.OPENAI_VECTOR_STORE_ID ??
  ""
)
  .trim();
const ORCHESTRATION_VERSION = "2026.03.05.1";

const FTE_CATEGORIES = [
  {
    id: 1,
    name: "Extracao e Tratamento de Minerais",
    cnae_prefixes: ["05", "06", "07", "08", "09"],
    keywords: ["mineracao", "extracao mineral", "pedreira", "areia", "argila", "calcario"],
  },
  {
    id: 2,
    name: "Industria de Produtos Minerais Nao Metalicos",
    cnae_prefixes: ["23"],
    keywords: ["ceramica", "cimento", "vidro", "gesso", "amianto"],
  },
  {
    id: 3,
    name: "Industria Metalurgica",
    cnae_prefixes: ["24"],
    keywords: ["siderurgia", "metalurgia", "aco", "ferro", "fundicao"],
  },
  {
    id: 4,
    name: "Industria Mecanica",
    cnae_prefixes: ["25", "28"],
    keywords: ["maquinas", "equipamentos", "caldeiraria", "usinagem"],
  },
  {
    id: 5,
    name: "Industria de Material Eletrico, Eletronico e Comunicacoes",
    cnae_prefixes: ["26", "27"],
    keywords: ["eletronico", "eletrico", "telecomunicacao", "semicondutor"],
  },
  {
    id: 6,
    name: "Industria de Material de Transporte",
    cnae_prefixes: ["29", "30"],
    keywords: ["veiculo", "automovel", "embarcacao", "aeronave", "locomotiva"],
  },
  {
    id: 7,
    name: "Industria de Madeira",
    cnae_prefixes: ["16"],
    keywords: ["madeira", "serraria", "compensado", "laminado"],
  },
  {
    id: 8,
    name: "Industria de Papel e Celulose",
    cnae_prefixes: ["17"],
    keywords: ["papel", "celulose", "papelao", "embalagem papel"],
  },
  {
    id: 9,
    name: "Industria de Borracha",
    cnae_prefixes: ["22.1"],
    keywords: ["borracha", "pneu", "artefato borracha"],
  },
  {
    id: 10,
    name: "Industria de Couros e Peles",
    cnae_prefixes: ["15.1"],
    keywords: ["couro", "curtume", "pele animal"],
  },
  {
    id: 11,
    name: "Industria Textil, de Vestuario, Calcados e Artefatos de Tecidos",
    cnae_prefixes: ["13", "15.2", "15.3", "15.4"],
    keywords: ["textil", "tecelagem", "fiacao", "tinturaria", "calcado"],
  },
  {
    id: 12,
    name: "Industria de Produtos de Materia Plastica",
    cnae_prefixes: ["22.2"],
    keywords: ["plastico", "polimero", "embalagem plastica"],
  },
  {
    id: 13,
    name: "Industria do Fumo",
    cnae_prefixes: ["12"],
    keywords: ["fumo", "tabaco", "cigarro"],
  },
  {
    id: 14,
    name: "Industrias Diversas",
    cnae_prefixes: ["32"],
    keywords: ["joalheria", "brinquedo", "instrumento musical"],
  },
  {
    id: 15,
    name: "Industria Quimica",
    cnae_prefixes: ["20", "21"],
    keywords: ["quimica", "farmaceutica", "petroquimica", "fertilizante", "agrotoxico", "tintas", "verniz", "resina", "solvente"],
  },
  {
    id: 16,
    name: "Industria de Produtos Alimentares e Bebidas",
    cnae_prefixes: ["10", "11"],
    keywords: ["alimento", "bebida", "frigorifico", "laticinio", "acucar", "alcool"],
  },
  {
    id: 17,
    name: "Servicos de Utilidade",
    cnae_prefixes: ["35", "36", "37", "38", "39"],
    keywords: ["energia", "agua", "esgoto", "residuo", "reciclagem", "limpeza urbana"],
  },
  {
    id: 18,
    name: "Transporte, Terminais, Depositos e Comercio",
    cnae_prefixes: ["49", "50", "51", "52"],
    keywords: ["transporte", "terminal", "armazem", "deposito", "combustivel", "posto gasolina"],
  },
  {
    id: 19,
    name: "Turismo",
    cnae_prefixes: ["55", "79"],
    keywords: ["hotel", "resort", "complexo turistico"],
  },
  {
    id: 20,
    name: "Uso de Recursos Naturais",
    cnae_prefixes: ["01", "02", "03"],
    keywords: ["silvicultura", "pesca", "aquicultura", "agricultura", "pecuaria", "fauna", "flora"],
  },
];

const CETESB_ANEXO5_CNAES = [
  "05",
  "06",
  "07",
  "08",
  "09",
  "10",
  "11",
  "12",
  "13",
  "14",
  "15",
  "16",
  "17",
  "18",
  "19",
  "20",
  "21",
  "22",
  "23",
  "24",
  "25",
  "26",
  "27",
  "28",
  "29",
  "30",
  "31",
  "32",
  "33",
  "35",
  "36",
  "37",
  "38",
  "39",
  "41",
  "42",
  "43",
  "45",
  "46",
  "47",
  "49",
  "50",
  "51",
  "52",
  "53",
  "55",
  "56",
  "71",
  "72",
  "75",
  "77",
  "80",
  "81",
  "82",
  "85",
  "86",
  "87",
  "88",
  "90",
  "91",
  "93",
  "94",
  "95",
  "96",
];

const CONSEMA_INDUSTRIAL_CNAES = [
  "1011",
  "1012",
  "1013",
  "1020",
  "1031",
  "1032",
  "1033",
  "1041",
  "1042",
  "1043",
  "1051",
  "1052",
  "1053",
  "1061",
  "1062",
  "1063",
  "1064",
  "1065",
  "1066",
  "1069",
  "1071",
  "1072",
  "1081",
  "1082",
  "1091",
  "1092",
  "1093",
  "1094",
  "1095",
  "1096",
  "1099",
  "1111",
  "1112",
  "1113",
  "1121",
  "1122",
  "1220",
  "1311",
  "1312",
  "1313",
  "1314",
  "1321",
  "1322",
  "1323",
  "1330",
  "1340",
  "1351",
  "1352",
  "1353",
  "1354",
  "1359",
  "1411",
  "1412",
  "1413",
  "1414",
  "1421",
  "1422",
  "1510",
  "1521",
  "1529",
  "1531",
  "1532",
  "1533",
  "1539",
  "1540",
  "1610",
  "1621",
  "1622",
  "1623",
  "1629",
  "1710",
  "1721",
  "1722",
  "1731",
  "1732",
  "1733",
  "1741",
  "1742",
  "1749",
  "1811",
  "1812",
  "1813",
  "1821",
  "1822",
  "1830",
  "1910",
  "1921",
  "1922",
  "1931",
  "1932",
  "2011",
  "2012",
  "2013",
  "2014",
  "2019",
  "2021",
  "2022",
  "2029",
  "2031",
  "2032",
  "2033",
  "2040",
  "2051",
  "2052",
  "2061",
  "2062",
  "2063",
  "2071",
  "2072",
  "2073",
  "2091",
  "2092",
  "2093",
  "2094",
  "2099",
  "2110",
  "2121",
  "2122",
  "2123",
  "2211",
  "2212",
  "2219",
  "2221",
  "2222",
  "2223",
  "2229",
  "2311",
  "2312",
  "2319",
  "2320",
  "2330",
  "2341",
  "2342",
  "2349",
  "2391",
  "2392",
  "2399",
  "2411",
  "2412",
  "2421",
  "2422",
  "2431",
  "2432",
  "2439",
  "2441",
  "2442",
  "2443",
  "2449",
  "2451",
  "2452",
  "2511",
  "2512",
  "2513",
  "2521",
  "2522",
  "2531",
  "2532",
  "2539",
  "2541",
  "2542",
  "2543",
  "2550",
  "2591",
  "2592",
  "2593",
  "2599",
  "2610",
  "2621",
  "2622",
  "2631",
  "2632",
  "2640",
  "2651",
  "2652",
  "2660",
  "2670",
  "2680",
  "2710",
  "2721",
  "2722",
  "2731",
  "2732",
  "2733",
  "2740",
  "2751",
  "2759",
  "2790",
  "2811",
  "2812",
  "2813",
  "2814",
  "2815",
  "2821",
  "2822",
  "2823",
  "2824",
  "2825",
  "2829",
  "2831",
  "2832",
  "2833",
  "2840",
  "2851",
  "2852",
  "2853",
  "2854",
  "2861",
  "2862",
  "2863",
  "2864",
  "2865",
  "2866",
  "2869",
  "2910",
  "2920",
  "2930",
  "2941",
  "2942",
  "2943",
  "2944",
  "2945",
  "2949",
  "2950",
  "3011",
  "3012",
  "3031",
  "3032",
  "3041",
  "3042",
  "3050",
  "3091",
  "3092",
  "3099",
  "3101",
  "3102",
  "3103",
  "3104",
  "3211",
  "3212",
  "3230",
  "3240",
  "3250",
  "3291",
  "3292",
  "3299",
  "3311",
  "3312",
  "3313",
  "3314",
  "3315",
  "3316",
  "3317",
  "3319",
  "3321",
  "3329",
  "3511",
  "3512",
  "3513",
  "3514",
  "3520",
  "3530",
  "3600",
  "3701",
  "3702",
  "3811",
  "3812",
  "3821",
  "3822",
  "3831",
  "3832",
  "3839",
  "3900",
];

export class EnvironmentalHttpError extends Error {
  /**
   * @param {number} statusCode
   * @param {string} message
   */
  constructor(statusCode, message) {
    super(message);
    this.name = "EnvironmentalHttpError";
    this.statusCode = statusCode;
  }
}

function cleanDigits(value) {
  return String(value ?? "").replace(/\D/g, "");
}

function normalizeCnpj(value) {
  return cleanDigits(value).slice(0, 14);
}

function normalizeCnaeCode(value) {
  return String(value ?? "").replace(/\D/g, "");
}

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function buildAddress(parts) {
  const line = [parts.logradouro, parts.numero].filter(Boolean).join(", ");
  const area = [parts.bairro, parts.municipio].filter(Boolean).join(" - ");
  const city = parts.uf ? `${area}/${parts.uf}` : area;
  return [line, city].filter(Boolean).join(" | ");
}

function normalizeCnaeListFromBrasilApi(payload) {
  const cnaes = [];

  const principalCode = String(payload?.cnae_fiscal ?? "").trim();
  if (principalCode) {
    cnaes.push({
      codigo: principalCode,
      descricao: String(payload?.cnae_fiscal_descricao ?? "").trim(),
      principal: true,
    });
  }

  if (Array.isArray(payload?.cnaes_secundarios)) {
    for (const item of payload.cnaes_secundarios) {
      const codigo = String(item?.codigo ?? "").trim();
      if (!codigo) continue;
      cnaes.push({
        codigo,
        descricao: String(item?.descricao ?? "").trim(),
        principal: false,
      });
    }
  }

  return cnaes;
}

function toCodeTextPair(input, fallbackPrincipal = false) {
  if (!input) return null;

  if (typeof input === "string" || typeof input === "number") {
    const value = String(input).trim();
    if (!value) return null;
    return { codigo: value, descricao: "", principal: fallbackPrincipal };
  }

  if (typeof input === "object") {
    const codeCandidate =
      input.codigo ??
      input.code ??
      input.id ??
      input.cnae ??
      input.subclasse ??
      input.subclass;

    const descricao =
      input.descricao ??
      input.description ??
      input.text ??
      input.nome ??
      input.name ??
      "";

    if (codeCandidate == null) return null;
    const codigo = String(codeCandidate).trim();
    if (!codigo) return null;

    const principal =
      typeof input.principal === "boolean"
        ? input.principal
        : typeof input.main === "boolean"
        ? input.main
        : fallbackPrincipal;

    return {
      codigo,
      descricao: String(descricao ?? "").trim(),
      principal,
    };
  }

  return null;
}

function extractOpenCnpjCnaes(payload) {
  const buckets = [
    { value: payload?.cnae_principal, principal: true },
    { value: payload?.cnaes_secundarios, principal: false },
    { value: payload?.atividade_principal, principal: true },
    { value: payload?.atividades_secundarias, principal: false },
    { value: payload?.estabelecimento?.atividade_principal, principal: true },
    { value: payload?.estabelecimento?.atividades_secundarias, principal: false },
    { value: payload?.main_activity, principal: true },
    { value: payload?.secondary_activities, principal: false },
  ];

  const list = [];
  for (const bucket of buckets) {
    if (Array.isArray(bucket.value)) {
      for (const raw of bucket.value) {
        const normalized = toCodeTextPair(raw, bucket.principal);
        if (normalized) list.push(normalized);
      }
      continue;
    }

    const normalized = toCodeTextPair(bucket.value, bucket.principal);
    if (normalized) list.push(normalized);
  }

  const deduped = new Map();
  for (const item of list) {
    const key = normalizeCnaeCode(item.codigo);
    if (!key) continue;
    const existing = deduped.get(key);
    if (!existing) {
      deduped.set(key, item);
      continue;
    }

    deduped.set(key, {
      ...existing,
      principal: existing.principal || item.principal,
      descricao: existing.descricao || item.descricao,
    });
  }

  return Array.from(deduped.values()).sort((a, b) => {
    if (a.principal !== b.principal) return a.principal ? -1 : 1;
    return a.codigo.localeCompare(b.codigo);
  });
}

function normalizeCompanyFromBrasilApi(payload, cnpj) {
  const cnaes = normalizeCnaeListFromBrasilApi(payload);
  return {
    razao_social: String(payload?.razao_social ?? payload?.nome_fantasia ?? "").trim(),
    nome_fantasia: String(payload?.nome_fantasia ?? "").trim(),
    cnpj,
    situacao: String(payload?.descricao_situacao_cadastral ?? payload?.situacao_cadastral ?? "").trim(),
    endereco: buildAddress({
      logradouro: payload?.logradouro,
      numero: payload?.numero,
      bairro: payload?.bairro,
      municipio: payload?.municipio,
      uf: payload?.uf,
    }),
    cnaes,
    source: "BrasilAPI",
  };
}

function normalizeCompanyFromOpenCnpj(payload, cnpj) {
  const estabelecimento = payload?.estabelecimento && typeof payload.estabelecimento === "object" ? payload.estabelecimento : payload;
  const companyRoot = payload?.empresa && typeof payload.empresa === "object" ? payload.empresa : payload;
  const cnaes = extractOpenCnpjCnaes(payload);

  return {
    razao_social: String(companyRoot?.razao_social ?? companyRoot?.razaoSocial ?? payload?.razao_social ?? "").trim(),
    nome_fantasia: String(estabelecimento?.nome_fantasia ?? payload?.nome_fantasia ?? "").trim(),
    cnpj,
    situacao: String(estabelecimento?.situacao_cadastral ?? payload?.situacao_cadastral ?? "").trim(),
    endereco: buildAddress({
      logradouro: estabelecimento?.logradouro,
      numero: estabelecimento?.numero,
      bairro: estabelecimento?.bairro,
      municipio: estabelecimento?.cidade ?? estabelecimento?.municipio,
      uf: estabelecimento?.estado ?? estabelecimento?.uf,
    }),
    cnaes,
    source: "OpenCNPJ",
  };
}

function normalizeCompanyFromReceitaWs(payload, cnpj) {
  const activityPrincipal = Array.isArray(payload?.atividade_principal) ? payload.atividade_principal : [];
  const activitiesSecondary = Array.isArray(payload?.atividades_secundarias) ? payload.atividades_secundarias : [];
  const cnaes = [];

  for (const item of activityPrincipal) {
    const normalized = toCodeTextPair(item, true);
    if (normalized) cnaes.push(normalized);
  }
  for (const item of activitiesSecondary) {
    const normalized = toCodeTextPair(item, false);
    if (normalized) cnaes.push(normalized);
  }

  return {
    razao_social: String(payload?.nome ?? payload?.razao_social ?? "").trim(),
    nome_fantasia: String(payload?.fantasia ?? payload?.nome_fantasia ?? "").trim(),
    cnpj,
    situacao: String(payload?.situacao ?? "").trim(),
    endereco: buildAddress({
      logradouro: payload?.logradouro,
      numero: payload?.numero,
      bairro: payload?.bairro,
      municipio: payload?.municipio,
      uf: payload?.uf,
    }),
    cnaes,
    source: "ReceitaWS",
  };
}

async function parseJsonResponse(response) {
  if (!response) return null;
  return response.json().catch(() => null);
}

function resolveSourceConfig(sourceId, fallbackName, fallbackTimeoutMs = 12000) {
  try {
    const config = getSourceConfig(sourceId);
    return {
      sourceId: config.id,
      name: config.name,
      timeoutMs: Number(config.timeoutMs ?? fallbackTimeoutMs),
      enabled: isSourceEnabled(sourceId),
    };
  } catch {
    return {
      sourceId,
      name: fallbackName || sourceId,
      timeoutMs: fallbackTimeoutMs,
      enabled: true,
    };
  }
}

function normalizeSourcePayload(sourceId, status, data = {}, fallbackName = "") {
  const config = resolveSourceConfig(sourceId, fallbackName);
  return {
    id: config.sourceId,
    name: config.name,
    status,
    latency_ms: Number(data.latencyMs ?? 0),
    status_reason: String(data.statusReason ?? ""),
    ...(data.message ? { message: data.message } : {}),
    ...(data.evidenceCount != null ? { evidence_count: Number(data.evidenceCount ?? 0) } : {}),
  };
}

function createOrchestration(cnpj) {
  return {
    version: ORCHESTRATION_VERSION,
    status: "running",
    started_at: new Date().toISOString(),
    completed_at: null,
    input: { cnpj },
    steps: [
      { agent: "agent_1_cnpj_cnae", title: "Consulta CNPJ/CNAE", status: "pending", started_at: null, completed_at: null },
      { agent: "agent_2_fte_rag_cnae", title: "Analise Profunda CNAE x FTE (RAG)", status: "pending", started_at: null, completed_at: null },
      { agent: "agent_3_ibama_fte", title: "IBAMA/CTF/FTE", status: "pending", started_at: null, completed_at: null },
      { agent: "agent_4_cetesb_sp", title: "CETESB (SP)", status: "pending", started_at: null, completed_at: null },
      { agent: "agent_5_municipal", title: "Municipal", status: "pending", started_at: null, completed_at: null },
      { agent: "agent_6_areas_contaminadas", title: "Areas Contaminadas", status: "pending", started_at: null, completed_at: null },
      { agent: "agent_7_relatorio_ai", title: "Relatorio IA", status: "pending", started_at: null, completed_at: null },
    ],
    events: [],
  };
}

function findOrchestrationStep(orchestration, agentId) {
  return orchestration.steps.find((step) => step.agent === agentId) ?? null;
}

function pushOrchestrationEvent(orchestration, agentId, status, message, payload = null) {
  orchestration.events.push({
    seq: orchestration.events.length + 1,
    at: new Date().toISOString(),
    agent: agentId,
    status,
    message,
    ...(payload && typeof payload === "object" ? { payload } : {}),
  });
}

function updateOrchestrationStep(orchestration, agentId, status, data = {}) {
  const step = findOrchestrationStep(orchestration, agentId);
  if (!step) return;

  const now = new Date().toISOString();
  if (status === "running" && !step.started_at) step.started_at = now;
  if ((status === "completed" || status === "failed") && !step.completed_at) step.completed_at = now;
  step.status = status;

  if (data.message) step.message = data.message;
  if (data.summary && typeof data.summary === "object") step.summary = data.summary;

  pushOrchestrationEvent(orchestration, agentId, status, data.message ?? "", data.summary ?? null);
}

async function fetchCompanyFromBrasilApi(cnpj) {
  const sourceId = "receita_brasilapi";
  const sourceConfig = resolveSourceConfig(sourceId, "Receita Federal (BrasilAPI)", 12000);
  const start = Date.now();

  if (!sourceConfig.enabled) {
    return {
      company: null,
      source: normalizeSourcePayload(sourceId, "unavailable", {
        latencyMs: Date.now() - start,
        statusReason: "feature_disabled",
      }),
    };
  }

  const response = await fetchWithTimeout(`${BRASILAPI_BASE_URL}/api/cnpj/v1/${cnpj}`, sourceConfig.timeoutMs, {
    headers: { accept: "application/json" },
  });

  if (!response) {
    return {
      company: null,
      source: normalizeSourcePayload(sourceId, "unavailable", {
        latencyMs: Date.now() - start,
        statusReason: "timeout_or_network",
      }),
    };
  }

  if (response.status === 404) {
    return {
      company: null,
      source: normalizeSourcePayload(sourceId, "not_found", {
        latencyMs: Date.now() - start,
        statusReason: "not_found",
      }),
    };
  }

  if (!response.ok) {
    return {
      company: null,
      source: normalizeSourcePayload(sourceId, "error", {
        latencyMs: Date.now() - start,
        statusReason: `http_${response.status}`,
      }),
    };
  }

  const payload = await parseJsonResponse(response);
  if (!payload || typeof payload !== "object") {
    return {
      company: null,
      source: normalizeSourcePayload(sourceId, "error", {
        latencyMs: Date.now() - start,
        statusReason: "invalid_json",
      }),
    };
  }

  const company = normalizeCompanyFromBrasilApi(payload, cnpj);
  if (!company.razao_social) {
    return {
      company: null,
      source: normalizeSourcePayload(sourceId, "error", {
        latencyMs: Date.now() - start,
        statusReason: "invalid_payload",
      }),
    };
  }

  return {
    company,
    source: normalizeSourcePayload(sourceId, "success", {
      latencyMs: Date.now() - start,
      statusReason: "ok",
      evidenceCount: 1,
    }),
  };
}

function buildOpenCnpjRequestUrls(cnpj) {
  const base = OPENCNPJ_BASE_URL || "https://api.opencnpj.org";
  const urls = [
    `${base}/${cnpj}`,
    `${base}/v1/cnpj/${cnpj}`,
    `${base}/cnpj/${cnpj}`,
  ];

  return [...new Set(urls)];
}

async function fetchCompanyFromOpenCnpj(cnpj) {
  const sourceId = "receita_opencnpj";
  const sourceConfig = resolveSourceConfig(sourceId, "Receita Federal (OpenCNPJ)", 12000);
  const start = Date.now();

  if (!sourceConfig.enabled) {
    return {
      company: null,
      source: normalizeSourcePayload(sourceId, "unavailable", {
        latencyMs: Date.now() - start,
        statusReason: "feature_disabled",
      }),
    };
  }

  const urls = buildOpenCnpjRequestUrls(cnpj);

  const baseHeaders = {
    accept: "application/json",
    ...(OPENCNPJ_API_KEY ? { "x-api-key": OPENCNPJ_API_KEY, Authorization: `Bearer ${OPENCNPJ_API_KEY}` } : {}),
  };

  for (const url of urls) {
    const response = await fetchWithTimeout(url, sourceConfig.timeoutMs, { headers: baseHeaders });
    if (!response) continue;
    if (response.status === 404) continue;
    if (!response.ok) {
      return {
        company: null,
        source: normalizeSourcePayload(sourceId, "error", {
          latencyMs: Date.now() - start,
          statusReason: `http_${response.status}`,
        }),
      };
    }

    const payload = await parseJsonResponse(response);
    if (!payload || typeof payload !== "object") continue;

    const company = normalizeCompanyFromOpenCnpj(payload, cnpj);
    if (!company.razao_social) continue;

    return {
      company,
      source: normalizeSourcePayload(sourceId, "success", {
        latencyMs: Date.now() - start,
        statusReason: "ok",
        evidenceCount: 1,
      }),
    };
  }

  return {
    company: null,
    source: normalizeSourcePayload(sourceId, "not_found", {
      latencyMs: Date.now() - start,
      statusReason: "not_found",
    }),
  };
}

async function fetchCompanyFromReceitaWs(cnpj) {
  const sourceId = "receita_receitaws";
  const sourceConfig = resolveSourceConfig(sourceId, "Receita Federal (ReceitaWS)", 12000);
  const start = Date.now();

  if (!sourceConfig.enabled) {
    return {
      company: null,
      source: normalizeSourcePayload(sourceId, "unavailable", {
        latencyMs: Date.now() - start,
        statusReason: "feature_disabled",
      }),
    };
  }

  const queryToken = RECEITAWS_API_TOKEN ? `?token=${encodeURIComponent(RECEITAWS_API_TOKEN)}` : "";
  const url = `${RECEITAWS_BASE_URL}/v1/cnpj/${cnpj}${queryToken}`;
  const response = await fetchWithTimeout(url, sourceConfig.timeoutMs, {
    headers: { accept: "application/json" },
  });

  if (!response) {
    return {
      company: null,
      source: normalizeSourcePayload(sourceId, "unavailable", {
        latencyMs: Date.now() - start,
        statusReason: "timeout_or_network",
      }),
    };
  }

  if (response.status === 404) {
    return {
      company: null,
      source: normalizeSourcePayload(sourceId, "not_found", {
        latencyMs: Date.now() - start,
        statusReason: "not_found",
      }),
    };
  }

  if (!response.ok) {
    return {
      company: null,
      source: normalizeSourcePayload(sourceId, "error", {
        latencyMs: Date.now() - start,
        statusReason: `http_${response.status}`,
      }),
    };
  }

  const payload = await parseJsonResponse(response);
  if (!payload || typeof payload !== "object") {
    return {
      company: null,
      source: normalizeSourcePayload(sourceId, "error", {
        latencyMs: Date.now() - start,
        statusReason: "invalid_json",
      }),
    };
  }

  if (String(payload.status ?? "").toUpperCase() === "ERROR") {
    return {
      company: null,
      source: normalizeSourcePayload(sourceId, "error", {
        latencyMs: Date.now() - start,
        statusReason: "upstream_error",
        message: String(payload.message ?? "Erro retornado pela ReceitaWS"),
      }),
    };
  }

  const company = normalizeCompanyFromReceitaWs(payload, cnpj);
  if (!company.razao_social) {
    return {
      company: null,
      source: normalizeSourcePayload(sourceId, "error", {
        latencyMs: Date.now() - start,
        statusReason: "invalid_payload",
      }),
    };
  }

  return {
    company,
    source: normalizeSourcePayload(sourceId, "success", {
      latencyMs: Date.now() - start,
      statusReason: "ok",
      evidenceCount: 1,
    }),
  };
}

async function fetchCompanyByCnpj(cnpj) {
  const attempts = [fetchCompanyFromBrasilApi, fetchCompanyFromOpenCnpj, fetchCompanyFromReceitaWs];
  const sources = [];

  for (const attempt of attempts) {
    const result = await attempt(cnpj);
    sources.push(result.source);
    if (result.company) {
      return {
        company: result.company,
        sources,
      };
    }
  }

  throw new EnvironmentalHttpError(404, "Nao foi possivel consultar o CNPJ em nenhuma fonte disponivel.");
}

function pickString(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function normalizeStringArray(values) {
  if (!Array.isArray(values)) return [];
  const deduped = new Set();
  const items = [];
  for (const value of values) {
    const text = pickString(value);
    if (!text) continue;
    const key = normalizeText(text);
    if (deduped.has(key)) continue;
    deduped.add(key);
    items.push(text);
  }
  return items;
}

function mapRiskLevel(value) {
  const text = normalizeText(value);
  if (text.includes("alto")) return "alto";
  if (text.includes("medio")) return "medio";
  if (text.includes("baixo")) return "baixo";
  return "nao_classificado";
}

function mapProbabilityLevel(value) {
  const text = normalizeText(value);
  if (text.includes("alta")) return "alta";
  if (text.includes("media") || text.includes("medio")) return "media";
  if (text.includes("baixa")) return "baixa";
  return "indefinida";
}

function parseJsonObjectFromText(text) {
  const content = String(text ?? "").trim();
  if (!content) return null;

  try {
    return JSON.parse(content);
  } catch {
    // continue
  }

  const fencedMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fencedMatch?.[1]) {
    try {
      return JSON.parse(fencedMatch[1]);
    } catch {
      // continue
    }
  }

  const firstBrace = content.indexOf("{");
  const lastBrace = content.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    try {
      return JSON.parse(content.slice(firstBrace, lastBrace + 1));
    } catch {
      return null;
    }
  }

  return null;
}

function extractOpenAiResponseText(payload) {
  const directText = pickString(payload?.output_text);
  if (directText) return directText;

  const chatText = pickString(payload?.choices?.[0]?.message?.content);
  if (chatText) return chatText;

  const outputItems = Array.isArray(payload?.output) ? payload.output : [];
  const chunks = [];
  for (const item of outputItems) {
    const contents = Array.isArray(item?.content) ? item.content : [];
    for (const content of contents) {
      const textCandidate = pickString(content?.text ?? content?.content ?? content?.value);
      if (textCandidate) chunks.push(textCandidate);
    }
  }

  const combined = chunks.join("\n\n").trim();
  return combined || null;
}

function extractOpenAiFileCitations(payload) {
  const citations = [];
  const seen = new Set();

  const pushCitation = (entry) => {
    const fileId = pickString(entry?.file_id);
    const filename = pickString(entry?.filename);
    const quote = pickString(entry?.quote);
    const key = `${fileId ?? ""}|${filename ?? ""}|${quote ?? ""}`;
    if (!fileId && !filename) return;
    if (seen.has(key)) return;
    seen.add(key);
    citations.push({
      file_id: fileId,
      filename,
      ...(quote ? { quote } : {}),
    });
  };

  const outputItems = Array.isArray(payload?.output) ? payload.output : [];

  for (const item of outputItems) {
    const contents = Array.isArray(item?.content) ? item.content : [];
    for (const content of contents) {
      const annotations = Array.isArray(content?.annotations) ? content.annotations : [];
      for (const annotation of annotations) {
        const citation = annotation?.file_citation && typeof annotation.file_citation === "object" ? annotation.file_citation : annotation;
        pushCitation({
          file_id: citation?.file_id,
          filename: citation?.filename ?? citation?.file_name,
          quote: citation?.quote,
        });
      }
    }

    const searchResults = Array.isArray(item?.results)
      ? item.results
      : Array.isArray(item?.file_search_call?.results)
      ? item.file_search_call.results
      : [];
    for (const result of searchResults) {
      pushCitation({
        file_id: result?.file_id,
        filename: result?.filename ?? result?.file_name,
      });
    }
  }

  return citations;
}

function normalizeFteReference(entry) {
  if (!entry || typeof entry !== "object") return null;

  const codigo = pickString(entry?.codigo ?? entry?.fte_codigo ?? entry?.id);
  const titulo = pickString(entry?.titulo ?? entry?.nome ?? entry?.fte ?? entry?.referencia ?? entry?.title);
  const categoria = pickString(entry?.categoria ?? entry?.categoria_fte);
  const justificativa = pickString(entry?.justificativa ?? entry?.encaixe ?? entry?.match_reason ?? entry?.rationale);
  const url = pickString(entry?.url ?? entry?.link ?? entry?.fonte);
  const trecho = pickString(entry?.trecho ?? entry?.citacao ?? entry?.quote);

  if (!codigo && !titulo && !justificativa && !url && !trecho) return null;

  return {
    ...(codigo ? { codigo } : {}),
    ...(titulo ? { titulo } : {}),
    ...(categoria ? { categoria } : {}),
    ...(justificativa ? { justificativa } : {}),
    ...(url ? { url } : {}),
    ...(trecho ? { trecho } : {}),
  };
}

function normalizeFteDeepFinding(entry, fallbackCnae = null) {
  const cnaeCodigo = pickString(entry?.cnae_codigo ?? entry?.cnae ?? entry?.codigo ?? fallbackCnae?.codigo ?? "");
  const cnaeDescricao = pickString(entry?.cnae_descricao ?? entry?.descricao ?? fallbackCnae?.descricao ?? "");
  const principal =
    typeof entry?.principal === "boolean"
      ? entry.principal
      : typeof fallbackCnae?.principal === "boolean"
      ? fallbackCnae.principal
      : false;

  const references = Array.isArray(entry?.ftes_relacionadas)
    ? entry.ftes_relacionadas
    : Array.isArray(entry?.referencias_fte)
    ? entry.referencias_fte
    : Array.isArray(entry?.fte_matches)
    ? entry.fte_matches
    : [];

  const normalizedReferences = [];
  for (const reference of references) {
    const normalized = normalizeFteReference(reference);
    if (normalized) normalizedReferences.push(normalized);
  }

  return {
    cnae_codigo: cnaeCodigo ?? "",
    cnae_descricao: cnaeDescricao ?? "",
    principal,
    risco: mapRiskLevel(entry?.risco ?? entry?.risk_level ?? entry?.nivel_risco),
    probabilidade_enquadramento: mapProbabilityLevel(
      entry?.probabilidade_enquadramento ?? entry?.probabilidade ?? entry?.probability ?? entry?.confianca
    ),
    tese_enquadramento: pickString(entry?.tese_enquadramento ?? entry?.tese ?? entry?.analise ?? entry?.argumentacao),
    obrigacoes: normalizeStringArray(entry?.obrigacoes ?? entry?.obligations),
    riscos_juridicos: normalizeStringArray(entry?.riscos_juridicos ?? entry?.legal_risks),
    recomendacoes_acao: normalizeStringArray(entry?.recomendacoes_acao ?? entry?.recomendacoes ?? entry?.actions),
    lacunas: normalizeStringArray(entry?.lacunas ?? entry?.gaps),
    ftes_relacionadas: normalizedReferences,
  };
}

function normalizeFteDeepAnalysisPayload(raw, cnaes, fallbackText = "") {
  const sourceObject = raw && typeof raw === "object" ? raw : {};
  const rawFindings = Array.isArray(sourceObject?.findings)
    ? sourceObject.findings
    : Array.isArray(sourceObject?.analises_cnae)
    ? sourceObject.analises_cnae
    : Array.isArray(sourceObject?.cnae_analysis)
    ? sourceObject.cnae_analysis
    : [];

  const byCnae = new Map();
  for (const entry of rawFindings) {
    const normalized = normalizeFteDeepFinding(entry);
    const key = normalizeCnaeCode(normalized.cnae_codigo);
    if (!key) continue;
    byCnae.set(key, normalized);
  }

  const normalizedFindings = [];
  const knownKeys = new Set();
  for (const cnae of cnaes) {
    const key = normalizeCnaeCode(cnae?.codigo);
    if (!key || knownKeys.has(key)) continue;
    knownKeys.add(key);
    const existing = byCnae.get(key);
    normalizedFindings.push(
      existing
        ? {
            ...existing,
            cnae_codigo: existing.cnae_codigo || cnae.codigo,
            cnae_descricao: existing.cnae_descricao || cnae.descricao,
            principal: existing.principal ?? Boolean(cnae.principal),
          }
        : normalizeFteDeepFinding(
            {
              tese_enquadramento: "Sem detalhamento estruturado retornado pela IA para este CNAE.",
            },
            cnae
          )
    );
  }

  const highRiskFindings = normalizedFindings.filter((item) => item.risco === "alto").length;
  const mediumRiskFindings = normalizedFindings.filter((item) => item.risco === "medio").length;
  const lowRiskFindings = normalizedFindings.filter((item) => item.risco === "baixo").length;

  return {
    executive_summary:
      pickString(sourceObject?.executive_summary ?? sourceObject?.resumo_executivo ?? sourceObject?.summary) ??
      (fallbackText ? fallbackText.slice(0, 1800) : ""),
    findings: normalizedFindings,
    overall_recommendations: normalizeStringArray(
      sourceObject?.overall_recommendations ?? sourceObject?.recomendacoes_gerais ?? sourceObject?.recommendations
    ),
    legal_risks: normalizeStringArray(sourceObject?.legal_risks ?? sourceObject?.riscos_legais),
    stats: {
      total_findings: normalizedFindings.length,
      high_risk_findings: highRiskFindings,
      medium_risk_findings: mediumRiskFindings,
      low_risk_findings: lowRiskFindings,
    },
  };
}

function extractGovBrContractSample(records) {
  if (!Array.isArray(records)) return [];
  return records.slice(0, 3).map((record) => ({
    numero: pickString(record?.numero ?? record?.numeroContrato ?? record?.codigoContrato ?? record?.numeroLicitacao),
    modalidade: pickString(record?.modalidadeCompra ?? record?.modalidadeLicitacao?.descricao ?? record?.modalidadeLicitacao),
    orgao: pickString(
      record?.unidadeGestora?.nome ??
        record?.orgao?.nome ??
        record?.orgaoVinculado?.nome ??
        record?.orgaoSuperior?.nome ??
        record?.nomeOrgao
    ),
    municipio: pickString(record?.unidadeGestora?.municipioNome ?? record?.municipioNome),
    valor: Number(record?.valorFinalCompra ?? record?.valorInicialCompra ?? record?.valor ?? record?.valorLicitacao ?? 0) || 0,
  }));
}

async function queryGovBrContractsContext(cnpj) {
  const sourceId = "cgu_licitacoes_contratos";
  const sourceConfig = resolveSourceConfig(sourceId, "Portal Transparencia - Licitacoes e Contratos", 15000);
  const start = Date.now();

  if (!sourceConfig.enabled) {
    return {
      context: null,
      source: normalizeSourcePayload(sourceId, "unavailable", {
        latencyMs: Date.now() - start,
        statusReason: "feature_disabled",
      }),
    };
  }

  if (!PORTAL_TRANSPARENCIA_API_KEY) {
    return {
      context: null,
      source: normalizeSourcePayload(sourceId, "unavailable", {
        latencyMs: Date.now() - start,
        statusReason: "missing_api_key",
        message: "Configure PORTAL_TRANSPARENCIA_API_KEY para habilitar consulta gov.br.",
      }),
    };
  }

  const endpoint =
    `https://api.portaldatransparencia.gov.br/api-de-dados/contratos/cpf-cnpj` +
    `?cpfCnpj=${encodeURIComponent(cnpj)}&pagina=1`;
  const response = await fetchWithTimeout(endpoint, sourceConfig.timeoutMs, {
    headers: {
      "chave-api-dados": PORTAL_TRANSPARENCIA_API_KEY,
      accept: "application/json",
    },
  });

  if (!response) {
    return {
      context: null,
      source: normalizeSourcePayload(sourceId, "unavailable", {
        latencyMs: Date.now() - start,
        statusReason: "timeout_or_network",
      }),
    };
  }

  if (!response.ok) {
    const errorPayload = await parseJsonResponse(response);
    const errorDetail = pickString(errorPayload?.detail ?? errorPayload?.message ?? errorPayload?.title);
    return {
      context: null,
      source: normalizeSourcePayload(sourceId, "error", {
        latencyMs: Date.now() - start,
        statusReason: `http_${response.status}`,
        message: errorDetail ? `Portal da Transparencia retornou ${response.status}: ${errorDetail}` : undefined,
      }),
    };
  }

  const payload = await parseJsonResponse(response);
  if (!Array.isArray(payload)) {
    return {
      context: null,
      source: normalizeSourcePayload(sourceId, "error", {
        latencyMs: Date.now() - start,
        statusReason: "invalid_payload",
      }),
    };
  }

  if (payload.length === 0) {
    return {
      context: {
        consulted: true,
        found_records: 0,
        sample: [],
      },
      source: normalizeSourcePayload(sourceId, "not_found", {
        latencyMs: Date.now() - start,
        statusReason: "not_found",
        evidenceCount: 0,
      }),
    };
  }

  return {
    context: {
      consulted: true,
      found_records: payload.length,
      sample: extractGovBrContractSample(payload),
    },
    source: normalizeSourcePayload(sourceId, "success", {
      latencyMs: Date.now() - start,
      statusReason: "ok",
      evidenceCount: payload.length,
    }),
  };
}

async function generateFteDeepCnaeAnalysis({ company }) {
  const sourceId = "openai_fte_rag";
  const sourceConfig = resolveSourceConfig(sourceId, "OpenAI - Analise CNAE x FTE", 60000);
  const start = Date.now();
  const cnaes = Array.isArray(company?.cnaes) ? company.cnaes : [];

  if (!sourceConfig.enabled) {
    return {
      analysis: {
        available: false,
        reason: "feature_disabled",
      },
      source: normalizeSourcePayload(sourceId, "unavailable", {
        latencyMs: Date.now() - start,
        statusReason: "feature_disabled",
      }),
    };
  }

  if (!OPENAI_API_KEY) {
    return {
      analysis: {
        available: false,
        reason: "OPENAI_API_KEY nao configurada.",
      },
      source: normalizeSourcePayload(sourceId, "unavailable", {
        latencyMs: Date.now() - start,
        statusReason: "missing_api_key",
        message: "Configure OPENAI_API_KEY para habilitar analise CNAE x FTE com RAG.",
      }),
    };
  }

  if (!OPENAI_FTE_VECTOR_STORE_ID) {
    return {
      analysis: {
        available: false,
        reason: "OPENAI_FTE_VECTOR_STORE_ID nao configurada.",
      },
      source: normalizeSourcePayload(sourceId, "unavailable", {
        latencyMs: Date.now() - start,
        statusReason: "missing_vector_store",
        message: "Configure OPENAI_FTE_VECTOR_STORE_ID com o Vector Store das FTEs.",
      }),
    };
  }

  if (cnaes.length === 0) {
    return {
      analysis: {
        available: false,
        reason: "Nenhum CNAE disponivel para analise.",
      },
      source: normalizeSourcePayload(sourceId, "not_found", {
        latencyMs: Date.now() - start,
        statusReason: "no_cnaes",
      }),
    };
  }

  const systemPrompt = [
    "Voce atua como auditor ambiental e advogado regulatorio senior no Brasil.",
    "Analise o encaixe de CADA CNAE informado nas FTEs do IBAMA usando exclusivamente evidencias recuperadas pela ferramenta file_search.",
    "Nao invente fatos, nao invente normas e nao afirme correspondencias sem lastro nos arquivos consultados.",
    "Priorize apontar fronteiras de enquadramento: o que entra, o que nao entra, linhas de corte, obrigacoes e riscos juridicos.",
    "Responda OBRIGATORIAMENTE em JSON valido (sem markdown) com a estrutura:",
    "{",
    '  "executive_summary": "string",',
    '  "findings": [',
    "    {",
    '      "cnae_codigo": "string",',
    '      "cnae_descricao": "string",',
    '      "principal": true,',
    '      "risco": "alto|medio|baixo|nao_classificado",',
    '      "probabilidade_enquadramento": "alta|media|baixa|indefinida",',
    '      "tese_enquadramento": "string",',
    '      "obrigacoes": ["string"],',
    '      "riscos_juridicos": ["string"],',
    '      "recomendacoes_acao": ["string"],',
    '      "lacunas": ["string"],',
    '      "ftes_relacionadas": [',
    "        {",
    '          "codigo": "string",',
    '          "titulo": "string",',
    '          "categoria": "string",',
    '          "justificativa": "string",',
    '          "url": "string",',
    '          "trecho": "string"',
    "        }",
    "      ]",
    "    }",
    "  ],",
    '  "overall_recommendations": ["string"],',
    '  "legal_risks": ["string"]',
    "}",
    "Se nao houver evidencia suficiente para um CNAE, preencha lacunas explicitamente e use risco 'nao_classificado'.",
  ].join("\n");

  const userPrompt = `Empresa alvo para analise CNAE x FTE:\n\n${JSON.stringify(
    {
      cnpj: company?.cnpj ?? null,
      razao_social: company?.razao_social ?? null,
      nome_fantasia: company?.nome_fantasia ?? null,
      cnaes,
    },
    null,
    2
  )}`;

  const response = await fetchWithTimeout("https://api.openai.com/v1/responses", sourceConfig.timeoutMs, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_FTE_MODEL,
      temperature: 0.1,
      input: [
        {
          role: "system",
          content: [{ type: "input_text", text: systemPrompt }],
        },
        {
          role: "user",
          content: [{ type: "input_text", text: userPrompt }],
        },
      ],
      tools: [
        {
          type: "file_search",
          vector_store_ids: [OPENAI_FTE_VECTOR_STORE_ID],
        },
      ],
      tool_choice: "auto",
      max_output_tokens: 2800,
    }),
  });

  if (!response) {
    return {
      analysis: {
        available: false,
        reason: "timeout_or_network",
      },
      source: normalizeSourcePayload(sourceId, "unavailable", {
        latencyMs: Date.now() - start,
        statusReason: "timeout_or_network",
      }),
    };
  }

  if (!response.ok) {
    const errorPayload = await parseJsonResponse(response);
    const errorDetail = pickString(errorPayload?.error?.message ?? errorPayload?.message ?? errorPayload?.detail);
    return {
      analysis: {
        available: false,
        reason: errorDetail ? `OpenAI HTTP ${response.status}: ${errorDetail}` : `OpenAI HTTP ${response.status}`,
      },
      source: normalizeSourcePayload(sourceId, "error", {
        latencyMs: Date.now() - start,
        statusReason: `http_${response.status}`,
        message: errorDetail ? `OpenAI retornou ${response.status}: ${errorDetail}` : undefined,
      }),
    };
  }

  const payload = await parseJsonResponse(response);
  const outputText = extractOpenAiResponseText(payload);
  if (!outputText) {
    return {
      analysis: {
        available: false,
        reason: "Resposta da OpenAI sem conteudo textual.",
      },
      source: normalizeSourcePayload(sourceId, "error", {
        latencyMs: Date.now() - start,
        statusReason: "invalid_payload",
      }),
    };
  }

  const parsedObject = parseJsonObjectFromText(outputText);
  const normalized = normalizeFteDeepAnalysisPayload(parsedObject, cnaes, outputText);
  const citations = extractOpenAiFileCitations(payload);
  const inputTokens = Number(payload?.usage?.input_tokens ?? payload?.usage?.prompt_tokens);
  const outputTokens = Number(payload?.usage?.output_tokens ?? payload?.usage?.completion_tokens);

  const analysis = {
    available: true,
    ...normalized,
    citations,
    model: OPENAI_FTE_MODEL,
    vector_store_id: OPENAI_FTE_VECTOR_STORE_ID,
    ...(Number.isFinite(inputTokens) ? { input_tokens: inputTokens } : {}),
    ...(Number.isFinite(outputTokens) ? { output_tokens: outputTokens } : {}),
    generated_at: new Date().toISOString(),
    ...(parsedObject ? {} : { parse_warning: "IA retornou texto nao estruturado; aplicado fallback parcial." }),
  };

  return {
    analysis,
    source: normalizeSourcePayload(sourceId, "success", {
      latencyMs: Date.now() - start,
      statusReason: "ok",
      evidenceCount: Math.max(citations.length, Number(analysis?.stats?.total_findings ?? 0), 1),
    }),
  };
}

function agentIBAMA(cnaes) {
  const results = [];
  const matchedCategories = new Set();

  for (const cnae of cnaes) {
    const code = normalizeCnaeCode(cnae.codigo);
    const prefix2 = code.slice(0, 2);
    const prefix3 = code.slice(0, 3);

    for (const category of FTE_CATEGORIES) {
      if (matchedCategories.has(category.id)) continue;

      const matched = category.cnae_prefixes.some((prefix) => {
        const cleanPrefix = normalizeCnaeCode(prefix);
        return code.startsWith(cleanPrefix) || prefix2 === cleanPrefix || prefix3 === cleanPrefix;
      });

      if (!matched) continue;

      matchedCategories.add(category.id);
      results.push({
        categoria: category.id,
        nome: category.name,
        cnae_match: cnae.codigo,
        cnae_desc: cnae.descricao,
        link_fte: "https://www.gov.br/ibama/pt-br/servicos/cadastros/ctf/ctf-app/ftes/ftes-por-categorias",
        link_tabela:
          "https://www.ibama.gov.br/phocadownload/qualidadeambiental/relatorios/2009/2019-03-06-Ibama-Tabela-FTE%20-completa.pdf",
        obrigacao: "Inscricao no CTF/APP obrigatoria. Verificar FTE especifica para confirmar enquadramento.",
        risco: "alto",
      });
    }
  }

  for (const cnae of cnaes) {
    const descricao = normalizeText(cnae.descricao);
    if (!descricao) continue;

    for (const category of FTE_CATEGORIES) {
      if (matchedCategories.has(category.id)) continue;
      const keywordMatch = category.keywords.some((keyword) => descricao.includes(normalizeText(keyword)));
      if (!keywordMatch) continue;

      matchedCategories.add(category.id);
      results.push({
        categoria: category.id,
        nome: category.name,
        cnae_match: cnae.codigo,
        cnae_desc: cnae.descricao,
        link_fte: "https://www.gov.br/ibama/pt-br/servicos/cadastros/ctf/ctf-app/ftes/ftes-por-categorias",
        link_tabela:
          "https://www.ibama.gov.br/phocadownload/qualidadeambiental/relatorios/2009/2019-03-06-Ibama-Tabela-FTE%20-completa.pdf",
        obrigacao: "Possivel enquadramento por descricao. Consultar FTE para confirmacao.",
        risco: "medio",
      });
    }
  }

  return {
    enquadrado: results.length > 0,
    matches: results,
    nota: "A CNAE e referencia, nao determinante. O enquadramento final depende da analise da FTE especifica (IN Ibama no 13/2021).",
    link_consulta: "https://www.gov.br/ibama/pt-br/servicos/cadastros/ctf/ctf-app/ftes/enquadramento-passo-a-passo",
  };
}

function agentCETESB(cnaes) {
  const results = [];

  for (const cnae of cnaes) {
    const code = normalizeCnaeCode(cnae.codigo);
    const prefix2 = code.slice(0, 2);

    if (!CETESB_ANEXO5_CNAES.includes(prefix2)) continue;

    results.push({
      cnae: cnae.codigo,
      descricao: cnae.descricao,
      tipo: "Anexo 5 - Fonte de Poluicao",
      obrigacao: "Licenciamento Ambiental obrigatorio (LP, LI, LO) conforme Art. 58 do Regulamento da Lei 997/76",
      risco: "alto",
      legislacao: ["Lei Estadual no 997/76", "Decreto no 8.468/76", "Decreto no 47.397/02"],
    });
  }

  const anexo10Prefixes = ["05", "06", "07", "08", "19", "20", "23", "24", "35", "36", "37", "38"];
  const needsLP = cnaes.some((cnae) => anexo10Prefixes.includes(normalizeCnaeCode(cnae.codigo).slice(0, 2)));

  const rmspRestricted = ["20", "24", "19", "23"];
  const rmspIssues = cnaes.filter((cnae) => rmspRestricted.includes(normalizeCnaeCode(cnae.codigo).slice(0, 2)));

  return {
    enquadrado: results.length > 0,
    matches: results,
    lp_precedente: needsLP,
    rmsp_restricoes: rmspIssues.length > 0,
    nota_rmsp:
      rmspIssues.length > 0
        ? "Atencao: Algumas atividades podem ter restricoes na RMSP (Lei Estadual no 1.817/78) e em areas de drenagem do Rio Piracicaba (Lei 9.825/97)."
        : null,
    links: {
      atividades: "https://licenciamento.cetesb.sp.gov.br/cetesb/atividades_empreendimentos.asp",
      tabela_atividades:
        "https://cetesb.sp.gov.br/licenciamentoambiental/wp-content/uploads/sites/32/2025/02/Atividades-passiveis-de-licenciamento.pdf",
      portal_licenciamento: "https://cetesb.sp.gov.br/licenciamentoambiental/",
    },
  };
}

function agentMunicipal(cnaes) {
  const results = [];

  for (const cnae of cnaes) {
    const code = normalizeCnaeCode(cnae.codigo);

    const isConsema = CONSEMA_INDUSTRIAL_CNAES.some((item) => code.startsWith(normalizeCnaeCode(item)));
    if (isConsema) {
      results.push({
        cnae: cnae.codigo,
        descricao: cnae.descricao,
        enquadramento: "Deliberacao CONSEMA 01/2024 - Impacto Local",
        competencia: "Municipal (se municipio habilitado) ou CETESB",
        risco: "medio",
      });
      continue;
    }

    const nonIndustrial = [
      { pattern: /^41|^42|^43/, desc: "Construcao civil / obras" },
      { pattern: /^55|^56/, desc: "Alojamento e alimentacao" },
      { pattern: /^86|^87|^88/, desc: "Saude" },
      { pattern: /^47/, desc: "Comercio varejista" },
      { pattern: /^49|^50|^51|^52/, desc: "Transporte e armazenamento" },
    ];

    const match = nonIndustrial.find((entry) => entry.pattern.test(code));
    if (!match) continue;

    results.push({
      cnae: cnae.codigo,
      descricao: cnae.descricao || match.desc,
      enquadramento: "Verificar Anexo I, item I da DN CONSEMA 01/2024 (atividades nao industriais)",
      competencia: "Municipal (conforme porte e impacto)",
      risco: "baixo",
    });
  }

  return {
    enquadrado: results.length > 0,
    matches: results,
    legislacao: {
      lc140: "https://www.planalto.gov.br/ccivil_03/leis/LCP/Lcp140.htm",
      consema: "https://smastr16.blob.core.windows.net/home/2024/03/Deliberacao-Normativa-CONSEMA-01_2024-assinada.pdf",
      municipios_habilitados: "https://semil.sp.gov.br/consema/licenciamento-ambiental-municipal/",
    },
    nota: "A competencia depende da habilitacao do municipio junto ao CONSEMA. Se nao habilitado, a CETESB assume o licenciamento.",
  };
}

function agentAreasContaminadas(endereco) {
  return {
    instrucao: "A verificacao de areas contaminadas requer consulta georreferenciada nos sistemas oficiais.",
    sistemas: [
      {
        nome: "Mapa Interativo SEMIL/CETESB",
        url: "https://mapas.semil.sp.gov.br/portal/apps/webappviewer/index.html?id=77da778c122c4ccda8a8d6babce61b63",
        descricao:
          "Mapa georreferenciado com areas contaminadas e reabilitadas do Estado de SP, com busca por endereco e camadas.",
        tipo: "geo",
      },
      {
        nome: "SIGAM - Relacao de Areas Contaminadas",
        url: "https://sigam.ambiente.sp.gov.br/sigam3/Default.aspx?idPagina=17676",
        descricao: "Sistema de busca textual por areas contaminadas e reabilitadas.",
        tipo: "lista",
      },
      {
        nome: "Relacao Georreferenciada CETESB",
        url: "https://cetesb.sp.gov.br/areas-contaminadas/relacao-de-areas-contaminadas/",
        descricao: "Relacao oficial atualizada da CETESB com estatisticas por municipio.",
        tipo: "relatorio",
      },
      {
        nome: "GeoSampa (Municipio de Sao Paulo)",
        url: "https://geosampa.prefeitura.sp.gov.br/",
        descricao: "Para empreendimentos na capital de Sao Paulo, com camadas municipais de areas contaminadas.",
        tipo: "geo",
      },
    ],
    legislacao: {
      lei_estadual: "Lei Estadual no 13.577/2009 - Protecao da qualidade do solo e gerenciamento de areas contaminadas",
      decreto: "Decreto no 59.263/2013 - Regulamenta a Lei 13.577/2009",
      it_cetesb: "Instrucao Tecnica no 039 da CETESB - Atividades Prioritarias para Gerenciamento de Areas Contaminadas",
    },
    alerta: endereco
      ? `Consulte os sistemas acima informando o endereco: ${endereco}`
      : "Informe o endereco do empreendimento para orientar a consulta nos mapas georreferenciados.",
  };
}

function countRisk(matches, level) {
  if (!Array.isArray(matches)) return 0;
  return matches.filter((item) => String(item?.risco ?? "") === level).length;
}

function classifyComplianceRisk({ fteDeepAnalysis, ibama, cetesb, municipal }) {
  const highCount =
    countRisk(fteDeepAnalysis?.findings, "alto") + countRisk(ibama.matches, "alto") + countRisk(cetesb.matches, "alto") + countRisk(municipal.matches, "alto");
  const mediumCount =
    countRisk(fteDeepAnalysis?.findings, "medio") +
    countRisk(ibama.matches, "medio") +
    countRisk(cetesb.matches, "medio") +
    countRisk(municipal.matches, "medio");

  if (highCount >= 3 || (highCount >= 1 && mediumCount >= 3)) return "alto";
  if (highCount >= 1 || mediumCount >= 2) return "medio";
  return "baixo";
}

function buildEnvironmentalAiPromptInput({
  company,
  fteDeepAnalysis,
  ibama,
  cetesb,
  municipal,
  areasContaminadas,
  govbrContext,
  summary,
  sources,
}) {
  return {
    company: {
      cnpj: company?.cnpj ?? null,
      razao_social: company?.razao_social ?? null,
      nome_fantasia: company?.nome_fantasia ?? null,
      situacao: company?.situacao ?? null,
      endereco: company?.endereco ?? null,
      cnaes: Array.isArray(company?.cnaes) ? company.cnaes : [],
    },
    summary: summary ?? {},
    fte_deep_analysis: {
      available: Boolean(fteDeepAnalysis?.available),
      reason: fteDeepAnalysis?.reason ?? null,
      executive_summary: fteDeepAnalysis?.executive_summary ?? null,
      findings: Array.isArray(fteDeepAnalysis?.findings) ? fteDeepAnalysis.findings : [],
      overall_recommendations: Array.isArray(fteDeepAnalysis?.overall_recommendations) ? fteDeepAnalysis.overall_recommendations : [],
      legal_risks: Array.isArray(fteDeepAnalysis?.legal_risks) ? fteDeepAnalysis.legal_risks : [],
      citations: Array.isArray(fteDeepAnalysis?.citations) ? fteDeepAnalysis.citations : [],
      stats: fteDeepAnalysis?.stats ?? null,
    },
    ibama: {
      enquadrado: Boolean(ibama?.enquadrado),
      matches: Array.isArray(ibama?.matches) ? ibama.matches : [],
      nota: ibama?.nota ?? null,
    },
    cetesb: {
      enquadrado: Boolean(cetesb?.enquadrado),
      matches: Array.isArray(cetesb?.matches) ? cetesb.matches : [],
      lp_precedente: Boolean(cetesb?.lp_precedente),
      rmsp_restricoes: Boolean(cetesb?.rmsp_restricoes),
      nota_rmsp: cetesb?.nota_rmsp ?? null,
    },
    municipal: {
      enquadrado: Boolean(municipal?.enquadrado),
      matches: Array.isArray(municipal?.matches) ? municipal.matches : [],
      nota: municipal?.nota ?? null,
    },
    areas_contaminadas: {
      alerta: areasContaminadas?.alerta ?? null,
      sistemas: Array.isArray(areasContaminadas?.sistemas) ? areasContaminadas.sistemas : [],
      instrucao: areasContaminadas?.instrucao ?? null,
    },
    govbr_context: govbrContext ?? null,
    sources: Array.isArray(sources) ? sources : [],
  };
}

async function generateEnvironmentalAiReport({
  company,
  fteDeepAnalysis,
  ibama,
  cetesb,
  municipal,
  areasContaminadas,
  govbrContext,
  summary,
  sources,
}) {
  const sourceId = "openai_relatorio_ambiental";
  const sourceConfig = resolveSourceConfig(sourceId, "OpenAI - Relatorio Ambiental", 45000);
  const start = Date.now();

  if (!sourceConfig.enabled) {
    return {
      analysis: {
        available: false,
        reason: "feature_disabled",
      },
      source: normalizeSourcePayload(sourceId, "unavailable", {
        latencyMs: Date.now() - start,
        statusReason: "feature_disabled",
      }),
    };
  }

  if (!OPENAI_API_KEY) {
    return {
      analysis: {
        available: false,
        reason: "OPENAI_API_KEY nao configurada.",
      },
      source: normalizeSourcePayload(sourceId, "unavailable", {
        latencyMs: Date.now() - start,
        statusReason: "missing_api_key",
        message: "Configure OPENAI_API_KEY para habilitar o ultimo agente (relatorio IA).",
      }),
    };
  }

  const systemPrompt = [
    "Voce e um especialista senior em compliance ambiental no Brasil.",
    "Produza um relatorio executivo em portugues do Brasil, sem inventar fatos.",
    "Use SOMENTE os dados fornecidos.",
    "Estruture obrigatoriamente com as secoes:",
    "1) Resumo Executivo",
    "2) Perfil e CNAEs",
    "3) Achados Profundos CNAE x FTE (RAG)",
    "4) Achados Regulatorios (IBAMA, CETESB, Municipal)",
    "5) Contratacoes Publicas (gov.br)",
    "6) Plano de Acao Prioritario (30-60-90 dias)",
    "7) Checklist de Evidencias para Auditoria",
    "8) Disclaimer Tecnico",
    "Se houver incerteza, explicite.",
    "Use linguagem objetiva e acionavel.",
  ].join("\n");

  const userPrompt = `Dados estruturados da analise ambiental:\n\n${JSON.stringify(
    buildEnvironmentalAiPromptInput({
      company,
      fteDeepAnalysis,
      ibama,
      cetesb,
      municipal,
      areasContaminadas,
      govbrContext,
      summary,
      sources,
    }),
    null,
    2
  )}`;

  const response = await fetchWithTimeout("https://api.openai.com/v1/chat/completions", sourceConfig.timeoutMs, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0.2,
      max_tokens: 1600,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }),
  });

  if (!response) {
    return {
      analysis: {
        available: false,
        reason: "timeout_or_network",
      },
      source: normalizeSourcePayload(sourceId, "unavailable", {
        latencyMs: Date.now() - start,
        statusReason: "timeout_or_network",
      }),
    };
  }

  if (!response.ok) {
    const errorPayload = await parseJsonResponse(response);
    const errorDetail = pickString(errorPayload?.error?.message ?? errorPayload?.message ?? errorPayload?.detail);
    return {
      analysis: {
        available: false,
        reason: errorDetail ? `OpenAI HTTP ${response.status}: ${errorDetail}` : `OpenAI HTTP ${response.status}`,
      },
      source: normalizeSourcePayload(sourceId, "error", {
        latencyMs: Date.now() - start,
        statusReason: `http_${response.status}`,
        message: errorDetail ? `OpenAI retornou ${response.status}: ${errorDetail}` : undefined,
      }),
    };
  }

  const payload = await parseJsonResponse(response);
  const narrative = pickString(payload?.choices?.[0]?.message?.content);
  if (!narrative) {
    return {
      analysis: {
        available: false,
        reason: "Resposta da OpenAI sem conteudo textual.",
      },
      source: normalizeSourcePayload(sourceId, "error", {
        latencyMs: Date.now() - start,
        statusReason: "invalid_payload",
      }),
    };
  }

  const inputTokens = Number(payload?.usage?.prompt_tokens);
  const outputTokens = Number(payload?.usage?.completion_tokens);

  return {
    analysis: {
      available: true,
      narrative,
      model: OPENAI_MODEL,
      ...(Number.isFinite(inputTokens) ? { input_tokens: inputTokens } : {}),
      ...(Number.isFinite(outputTokens) ? { output_tokens: outputTokens } : {}),
      generated_at: new Date().toISOString(),
    },
    source: normalizeSourcePayload(sourceId, "success", {
      latencyMs: Date.now() - start,
      statusReason: "ok",
      evidenceCount: 1,
    }),
  };
}

function buildDisclaimers() {
  return [
    "Correspondencia CNAE x obrigacao ambiental e indicativa, nao vinculante.",
    "Enquadramento definitivo requer analise tecnica especializada e consulta das FTEs oficiais.",
    "Agentes estaduais e municipais estao calibrados para o Estado de Sao Paulo.",
    "Analise profunda CNAE x FTE depende do acervo RAG carregado no OpenAI Vector Store.",
    "Sistemas de areas contaminadas exigem consulta manual em portais GIS oficiais.",
    "Relatorio de IA tem carater de apoio e nao substitui parecer tecnico-juridico especializado.",
  ];
}

/**
 * @param {string} cnpj
 */
export async function analyzeEnvironmentalCompliance(cnpj) {
  const cleanCnpj = normalizeCnpj(cnpj);
  if (cleanCnpj.length !== 14) {
    throw new EnvironmentalHttpError(400, "CNPJ invalido. Deve conter 14 digitos.");
  }

  const orchestration = createOrchestration(cleanCnpj);

  let company = null;
  let sources = [];
  let fteDeepAnalysis = null;
  let ibama = null;
  let cetesb = null;
  let municipal = null;
  let areasContaminadas = null;
  let govbrContext = null;
  let aiReport = null;

  updateOrchestrationStep(orchestration, "agent_1_cnpj_cnae", "running", {
    message: "Consultando CNPJ e extraindo CNAEs.",
  });
  try {
    const companyLookup = await fetchCompanyByCnpj(cleanCnpj);
    company = companyLookup.company;
    sources = companyLookup.sources;
    const govbrResult = await queryGovBrContractsContext(cleanCnpj);
    govbrContext = govbrResult.context;
    sources.push(govbrResult.source);

    updateOrchestrationStep(orchestration, "agent_1_cnpj_cnae", "completed", {
      message: `CNPJ localizado com ${company.cnaes.length} CNAE(s).`,
      summary: {
        source: company.source,
        cnaes_count: company.cnaes.length,
        govbr_consulted: Boolean(govbrResult.context?.consulted),
        govbr_records: Number(govbrResult.context?.found_records ?? 0),
      },
    });
  } catch (error) {
    updateOrchestrationStep(orchestration, "agent_1_cnpj_cnae", "failed", {
      message: error instanceof Error ? error.message : "Falha no agente 1.",
    });
    orchestration.status = "failed";
    orchestration.completed_at = new Date().toISOString();
    throw error;
  }

  if (!company || !Array.isArray(company.cnaes) || company.cnaes.length === 0) {
    throw new EnvironmentalHttpError(422, "Nenhum CNAE encontrado para este CNPJ.");
  }

  updateOrchestrationStep(orchestration, "agent_2_fte_rag_cnae", "running", {
    message: "Executando analise aprofundada CNAE x FTE com RAG.",
  });
  const fteResult = await generateFteDeepCnaeAnalysis({ company });
  fteDeepAnalysis = fteResult.analysis;
  sources.push(fteResult.source);
  updateOrchestrationStep(orchestration, "agent_2_fte_rag_cnae", "completed", {
    message: fteDeepAnalysis?.available
      ? `Analise profunda concluida para ${fteDeepAnalysis?.stats?.total_findings ?? company.cnaes.length} CNAE(s).`
      : `Analise profunda indisponivel: ${fteDeepAnalysis?.reason ?? "motivo nao informado"}`,
    summary: {
      available: Boolean(fteDeepAnalysis?.available),
      findings: Number(fteDeepAnalysis?.stats?.total_findings ?? 0),
      high_risk_findings: Number(fteDeepAnalysis?.stats?.high_risk_findings ?? 0),
      source_status: fteResult?.source?.status ?? "unknown",
    },
  });

  updateOrchestrationStep(orchestration, "agent_3_ibama_fte", "running", {
    message: "Aplicando regras de enquadramento IBAMA/CTF/FTE.",
  });
  ibama = agentIBAMA(company.cnaes);
  updateOrchestrationStep(orchestration, "agent_3_ibama_fte", "completed", {
    message: `${ibama.matches.length} possivel(is) enquadramento(s) no IBAMA.`,
    summary: {
      enquadrado: ibama.enquadrado,
      matches: ibama.matches.length,
    },
  });

  updateOrchestrationStep(orchestration, "agent_4_cetesb_sp", "running", {
    message: "Aplicando regras CETESB para o Estado de SP.",
  });
  cetesb = agentCETESB(company.cnaes);
  updateOrchestrationStep(orchestration, "agent_4_cetesb_sp", "completed", {
    message: `${cetesb.matches.length} atividade(s) potencialmente sujeita(s) a licenciamento CETESB.`,
    summary: {
      enquadrado: cetesb.enquadrado,
      matches: cetesb.matches.length,
      lp_precedente: cetesb.lp_precedente,
      rmsp_restricoes: cetesb.rmsp_restricoes,
    },
  });

  updateOrchestrationStep(orchestration, "agent_5_municipal", "running", {
    message: "Aplicando regras de impacto local (LC 140/2011 e DN CONSEMA 01/2024).",
  });
  municipal = agentMunicipal(company.cnaes);
  updateOrchestrationStep(orchestration, "agent_5_municipal", "completed", {
    message: `${municipal.matches.length} atividade(s) com potencial competencia municipal.`,
    summary: {
      enquadrado: municipal.enquadrado,
      matches: municipal.matches.length,
    },
  });

  updateOrchestrationStep(orchestration, "agent_6_areas_contaminadas", "running", {
    message: "Gerando orientacoes para consulta de areas contaminadas.",
  });
  areasContaminadas = agentAreasContaminadas(company.endereco);
  updateOrchestrationStep(orchestration, "agent_6_areas_contaminadas", "completed", {
    message: `${areasContaminadas.sistemas.length} sistema(s) de consulta disponibilizados.`,
    summary: {
      systems: areasContaminadas.sistemas.length,
      manual_consult_required: true,
    },
  });

  const fteAlerts = countRisk(fteDeepAnalysis?.findings, "alto") + countRisk(fteDeepAnalysis?.findings, "medio");
  const totalAlerts =
    Number(fteAlerts ?? 0) + Number(ibama.matches?.length ?? 0) + Number(cetesb.matches?.length ?? 0) + Number(municipal.matches?.length ?? 0);
  const riskLevel = classifyComplianceRisk({ fteDeepAnalysis, ibama, cetesb, municipal });
  const summary = {
    total_alerts: totalAlerts,
    fte_alerts: Number(fteAlerts ?? 0),
    ibama_alerts: Number(ibama.matches?.length ?? 0),
    cetesb_alerts: Number(cetesb.matches?.length ?? 0),
    municipal_alerts: Number(municipal.matches?.length ?? 0),
    risk_level: riskLevel,
  };

  updateOrchestrationStep(orchestration, "agent_7_relatorio_ai", "running", {
    message: "Gerando relatorio de IA a partir dos achados ambientais.",
  });
  const aiResult = await generateEnvironmentalAiReport({
    company,
    fteDeepAnalysis,
    ibama,
    cetesb,
    municipal,
    areasContaminadas,
    govbrContext,
    summary,
    sources,
  });
  aiReport = aiResult.analysis;
  sources.push(aiResult.source);
  updateOrchestrationStep(orchestration, "agent_7_relatorio_ai", "completed", {
    message: aiReport?.available
      ? "Relatorio IA gerado com sucesso."
      : `Relatorio IA indisponivel: ${aiReport?.reason ?? "motivo nao informado"}`,
    summary: {
      available: Boolean(aiReport?.available),
      model: aiReport?.model ?? null,
      source_status: aiResult?.source?.status ?? "unknown",
    },
  });

  orchestration.status = "completed";
  orchestration.completed_at = new Date().toISOString();

  return {
    cnpj: cleanCnpj,
    company,
    fte_deep_analysis: fteDeepAnalysis,
    ibama,
    cetesb,
    municipal,
    areas_contaminadas: areasContaminadas,
    govbr_context: govbrContext,
    ai_report: aiReport,
    summary,
    orchestration,
    disclaimers: buildDisclaimers(),
    sources,
    analyzed_at: new Date().toISOString(),
  };
}
