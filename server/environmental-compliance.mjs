import { createHash } from "node:crypto";
import { fetchWithTimeout } from "./http-utils.mjs";
import { buildCoverageMatrix, getEnvironmentalSourceCatalog } from "./environmental-source-catalog.mjs";
import { findRuleById, getEnvironmentalRuleCatalog } from "./environmental-rule-catalog.mjs";
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
const OPENAI_FTE_RAG_TIMEOUT_MS = Number.parseInt(process.env.OPENAI_FTE_RAG_TIMEOUT_MS ?? "28000", 10);
const OPENAI_FTE_RAG_RETRY_TIMEOUT_MS = Number.parseInt(process.env.OPENAI_FTE_RAG_RETRY_TIMEOUT_MS ?? "36000", 10);
const OPENAI_FTE_RAG_CNAE_LIMIT = Number.parseInt(process.env.OPENAI_FTE_RAG_CNAE_LIMIT ?? "6", 10);
const OPENAI_FTE_RAG_MAX_OUTPUT_TOKENS = Number.parseInt(process.env.OPENAI_FTE_RAG_MAX_OUTPUT_TOKENS ?? "2600", 10);
const OPENAI_FTE_RAG_TEMPERATURE = Number.parseFloat(process.env.OPENAI_FTE_RAG_TEMPERATURE ?? "0");
const OPENAI_RELATORIO_TIMEOUT_MS = Number.parseInt(process.env.OPENAI_RELATORIO_TIMEOUT_MS ?? "15000", 10);
const ORCHESTRATION_VERSION = "2026.03.05.1";
const SEMIL_AREAS_CONTAMINADAS_APP_ID = "77da778c122c4ccda8a8d6babce61b6b";
const SEMIL_AREAS_CONTAMINADAS_MAP_OPEN_URL = `https://mapas.semil.sp.gov.br/portal/apps/webappviewer/index.html?id=${SEMIL_AREAS_CONTAMINADAS_APP_ID}`;
const SEMIL_AREAS_CONTAMINADAS_MAP_EMBED_URL = SEMIL_AREAS_CONTAMINADAS_MAP_OPEN_URL;
const SEMIL_AREAS_CONTAMINADAS_SERVICE_BASE =
  "https://mapas.semil.sp.gov.br/server/rest/services/SIGAM/Empreendimento_Contaminacao_SGP/MapServer";
const SEMIL_AREAS_LAYER_IDS = [1, 2];

const FTE_CATEGORIES = [
  {
    id: 1,
    name: "Extração e Tratamento de Minerais",
    cnae_prefixes: ["05", "06", "07", "08", "09"],
    keywords: ["mineração", "extração mineral", "pedreira", "areia", "argila", "calcário"],
  },
  {
    id: 2,
    name: "Indústria de Produtos Minerais Não Metálicos",
    cnae_prefixes: ["23"],
    keywords: ["ceramica", "cimento", "vidro", "gesso", "amianto"],
  },
  {
    id: 3,
    name: "Indústria Metalúrgica",
    cnae_prefixes: ["24"],
    keywords: ["siderurgia", "metalurgia", "aco", "ferro", "fundicao"],
  },
  {
    id: 4,
    name: "Indústria Mecânica",
    cnae_prefixes: ["25", "28"],
    keywords: ["maquinas", "equipamentos", "caldeiraria", "usinagem"],
  },
  {
    id: 5,
    name: "Indústria de Material Elétrico, Eletrônico e Comunicações",
    cnae_prefixes: ["26", "27"],
    keywords: ["eletrônico", "elétrico", "telecomunicação", "semicondutor"],
  },
  {
    id: 6,
    name: "Indústria de Material de Transporte",
    cnae_prefixes: ["29", "30"],
    keywords: ["veículo", "automóvel", "embarcação", "aeronave", "locomotiva"],
  },
  {
    id: 7,
    name: "Indústria de Madeira",
    cnae_prefixes: ["16"],
    keywords: ["madeira", "serraria", "compensado", "laminado"],
  },
  {
    id: 8,
    name: "Indústria de Papel e Celulose",
    cnae_prefixes: ["17"],
    keywords: ["papel", "celulose", "papelão", "embalagem papel"],
  },
  {
    id: 9,
    name: "Indústria de Borracha",
    cnae_prefixes: ["22.1"],
    keywords: ["borracha", "pneu", "artefato borracha"],
  },
  {
    id: 10,
    name: "Indústria de Couros e Peles",
    cnae_prefixes: ["15.1"],
    keywords: ["couro", "curtume", "pele animal"],
  },
  {
    id: 11,
    name: "Indústria Têxtil, de Vestuário, Calçados e Artefatos de Tecidos",
    cnae_prefixes: ["13", "15.2", "15.3", "15.4"],
    keywords: ["têxtil", "tecelagem", "fiação", "tinturaria", "calçado"],
  },
  {
    id: 12,
    name: "Indústria de Produtos de Matéria Plástica",
    cnae_prefixes: ["22.2"],
    keywords: ["plastico", "polimero", "embalagem plastica"],
  },
  {
    id: 13,
    name: "Indústria do Fumo",
    cnae_prefixes: ["12"],
    keywords: ["fumo", "tabaco", "cigarro"],
  },
  {
    id: 14,
    name: "Indústrias Diversas",
    cnae_prefixes: ["32"],
    keywords: ["joalheria", "brinquedo", "instrumento musical"],
  },
  {
    id: 15,
    name: "Indústria Química",
    cnae_prefixes: ["20", "21"],
    keywords: ["quimica", "farmacêutica", "petroquímica", "fertilizante", "agrotóxico", "tintas", "verniz", "resina", "solvente"],
  },
  {
    id: 16,
    name: "Indústria de Produtos Alimentares e Bebidas",
    cnae_prefixes: ["10", "11"],
    keywords: ["alimento", "bebida", "frigorífico", "laticínio", "açúcar", "álcool"],
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

function normalizeCep(value) {
  const digits = cleanDigits(value);
  if (!digits) return "";
  return digits.slice(0, 8);
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

function hashObject(value) {
  return createHash("sha256").update(JSON.stringify(value ?? null)).digest("hex").slice(0, 24);
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
  const municipio = String(payload?.municipio ?? "").trim();
  const uf = String(payload?.uf ?? "").trim().toUpperCase();
  const bairro = String(payload?.bairro ?? "").trim();
  const logradouro = String(payload?.logradouro ?? "").trim();
  const numero = String(payload?.numero ?? "").trim();
  const cep = normalizeCep(payload?.cep ?? payload?.cep_formatado);
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
    municipio,
    uf,
    bairro,
    logradouro,
    numero,
    cep,
    cnaes,
    source: "BrasilAPI",
  };
}

function normalizeCompanyFromOpenCnpj(payload, cnpj) {
  const estabelecimento = payload?.estabelecimento && typeof payload.estabelecimento === "object" ? payload.estabelecimento : payload;
  const companyRoot = payload?.empresa && typeof payload.empresa === "object" ? payload.empresa : payload;
  const cnaes = extractOpenCnpjCnaes(payload);
  const municipio = String(estabelecimento?.cidade ?? estabelecimento?.municipio ?? "").trim();
  const uf = String(estabelecimento?.estado ?? estabelecimento?.uf ?? "").trim().toUpperCase();
  const bairro = String(estabelecimento?.bairro ?? "").trim();
  const logradouro = String(estabelecimento?.logradouro ?? "").trim();
  const numero = String(estabelecimento?.numero ?? "").trim();
  const cep = normalizeCep(estabelecimento?.cep);

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
    municipio,
    uf,
    bairro,
    logradouro,
    numero,
    cep,
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
  const municipio = String(payload?.municipio ?? "").trim();
  const uf = String(payload?.uf ?? "").trim().toUpperCase();
  const bairro = String(payload?.bairro ?? "").trim();
  const logradouro = String(payload?.logradouro ?? "").trim();
  const numero = String(payload?.numero ?? "").trim();
  const cep = normalizeCep(payload?.cep);

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
    municipio,
    uf,
    bairro,
    logradouro,
    numero,
    cep,
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

function upsertSourcePayload(list, source) {
  if (!source || typeof source !== "object") return Array.isArray(list) ? list : [];
  const items = Array.isArray(list) ? [...list] : [];
  const index = items.findIndex((entry) => entry?.id === source.id);
  if (index >= 0) {
    items[index] = { ...items[index], ...source };
    return items;
  }
  items.push(source);
  return items;
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
      { agent: "agent_2_fte_rag_cnae", title: "Análise Profunda CNAE x FTE (RAG)", status: "pending", started_at: null, completed_at: null },
      { agent: "agent_3_ibama_fte", title: "Regras Federais (IBAMA/CTF/FTE)", status: "pending", started_at: null, completed_at: null },
      { agent: "agent_4_state", title: "Regras Estaduais (UF)", status: "pending", started_at: null, completed_at: null },
      { agent: "agent_5_municipal", title: "Regras Municipais", status: "pending", started_at: null, completed_at: null },
      { agent: "agent_6_areas_contaminadas", title: "Áreas Contaminadas", status: "pending", started_at: null, completed_at: null },
      { agent: "agent_7_relatorio_ai", title: "Relatório IA Auditável", status: "pending", started_at: null, completed_at: null },
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

function buildJurisdictionContext(company) {
  return {
    uf: String(company?.uf ?? "").trim().toUpperCase() || null,
    municipio_ibge: null,
    municipio_nome: String(company?.municipio ?? "").trim() || null,
    scope_mode: "national",
  };
}

function buildEvidenceRecord({
  agent,
  source,
  jurisdiction,
  ruleId = null,
  status = "success",
  confidence = "media",
  summary = "",
  input = null,
  output = null,
}) {
  const rule = ruleId ? findRuleById(ruleId) : null;
  return {
    id: `ev_${hashObject({ agent, source, ruleId, summary, at: Date.now() })}`,
    at: new Date().toISOString(),
    agent,
    source_id: source?.id ?? null,
    source_name: source?.name ?? null,
    jurisdiction: jurisdiction ?? "federal",
    rule_id: rule?.rule_id ?? ruleId ?? null,
    regra_aplicada: rule
      ? {
          base_legal: Array.isArray(rule.base_legal) ? rule.base_legal : [],
          condicao: rule.condicao ?? "",
          severidade: rule.severidade ?? "",
          obrigacao_resultante: rule.obrigacao_resultante ?? "",
        }
      : null,
    status,
    confianca: confidence,
    resumo: String(summary ?? "").trim(),
    input_hash: hashObject(input),
    output_hash: hashObject(output),
  };
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

  throw new EnvironmentalHttpError(404, "Não foi possível consultar o CNPJ em nenhuma fonte disponível.");
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

function trimText(value, maxChars = 280) {
  const text = pickString(value);
  if (!text) return null;
  if (!Number.isFinite(maxChars) || maxChars <= 0) return text;
  return text.length > maxChars ? `${text.slice(0, maxChars - 1)}…` : text;
}

function limitStringArray(values, maxItems = 2) {
  const normalized = normalizeStringArray(values);
  const safeMax = Math.max(0, Number.parseInt(String(maxItems), 10) || 0);
  return safeMax > 0 ? normalized.slice(0, safeMax) : [];
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

  const codigo = trimText(entry?.codigo ?? entry?.fte_codigo ?? entry?.id, 40);
  const titulo = trimText(entry?.titulo ?? entry?.nome ?? entry?.fte ?? entry?.referencia ?? entry?.title, 180);
  const categoria = trimText(entry?.categoria ?? entry?.categoria_fte, 160);
  const justificativa = trimText(entry?.justificativa ?? entry?.encaixe ?? entry?.match_reason ?? entry?.rationale, 220);
  const url = trimText(entry?.url ?? entry?.link ?? entry?.fonte, 300);
  const trecho = trimText(entry?.trecho ?? entry?.citacao ?? entry?.quote, 300);

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

function buildDeterministicFteReference(category, matchType) {
  if (!category || typeof category !== "object") return null;
  return normalizeFteReference({
    codigo: String(category.id ?? ""),
    titulo: `Cat. ${category.id} - ${category.name}`,
    categoria: category.name,
    justificativa:
      matchType === "prefix"
        ? "Aderência preliminar por prefixo CNAE."
        : "Aderência preliminar por similaridade textual da descrição.",
    url: "https://www.gov.br/ibama/pt-br/servicos/cadastros/ctf/ctf-app/ftes/ftes-por-categorias",
  });
}

function normalizeFteDeepFinding(entry, fallbackCnae = null) {
  const cnaeCodigo = trimText(entry?.cnae_codigo ?? entry?.cnae ?? entry?.codigo ?? fallbackCnae?.codigo ?? "", 20);
  const cnaeDescricao = trimText(entry?.cnae_descricao ?? entry?.descricao ?? fallbackCnae?.descricao ?? "", 260);
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
    tese_enquadramento: trimText(entry?.tese_enquadramento ?? entry?.tese ?? entry?.analise ?? entry?.argumentacao, 320),
    obrigacoes: limitStringArray(entry?.obrigacoes ?? entry?.obligations, 2),
    riscos_juridicos: limitStringArray(entry?.riscos_juridicos ?? entry?.legal_risks, 2),
    recomendacoes_acao: limitStringArray(entry?.recomendacoes_acao ?? entry?.recomendacoes ?? entry?.actions, 2),
    lacunas: limitStringArray(entry?.lacunas ?? entry?.gaps, 3),
    ftes_relacionadas: normalizedReferences.slice(0, 2),
  };
}

function buildConservativeMissingFteFinding(cnae) {
  const match = matchFteCategoryForCnae(cnae);
  const category = match?.category;
  const deterministicRef = buildDeterministicFteReference(category, match?.matchType);

  return normalizeFteDeepFinding(
    {
      cnae_codigo: cnae?.codigo ?? "",
      cnae_descricao: cnae?.descricao ?? "",
      principal: Boolean(cnae?.principal),
      risco: category ? "medio" : "nao_classificado",
      probabilidade_enquadramento: category ? "media" : "indefinida",
      tese_enquadramento: category
        ? `Sem retorno estruturado da IA; aplicado critério conservador com aderência preliminar à Cat. ${category.id} (${category.name}).`
        : "Sem detalhamento estruturado retornado pela IA para este CNAE.",
      obrigacoes: category
        ? [
            "Validar enquadramento na FTE específica do IBAMA com suporte técnico-jurídico.",
          ]
        : [],
      recomendacoes_acao: category
        ? [
            "Revisar o CNAE com foco na atividade efetivamente exercida e confirmar FTE aplicável.",
          ]
        : ["Executar análise técnica complementar para concluir o enquadramento."],
      lacunas: category
        ? [
            "Classificação conservadora aplicada por ausência de citação textual específica nesta execução.",
          ]
        : [
            "Sem evidência estruturada suficiente para enquadramento preliminar neste CNAE.",
          ],
      ftes_relacionadas: deterministicRef ? [deterministicRef] : [],
    },
    cnae
  );
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
        : buildConservativeMissingFteFinding(cnae)
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

function hasLegalReferenceSupport(finding) {
  const refs = Array.isArray(finding?.ftes_relacionadas) ? finding.ftes_relacionadas : [];
  return refs.some((ref) => Boolean(pickString(ref?.codigo) || pickString(ref?.titulo) || pickString(ref?.url) || pickString(ref?.trecho)));
}

function applyLegalStabilityGuards({ analysis, cnaes, citations }) {
  const sourceAnalysis = analysis && typeof analysis === "object" ? analysis : {};
  const sourceFindings = Array.isArray(sourceAnalysis?.findings) ? sourceAnalysis.findings : [];
  const knownByCode = new Map(
    (Array.isArray(cnaes) ? cnaes : [])
      .map((item) => [normalizeCnaeCode(item?.codigo), item])
      .filter(([code]) => Boolean(code))
  );

  const hasGlobalCitations = Array.isArray(citations) && citations.length > 0;
  const reviewedFindings = sourceFindings
    .map((rawItem) => {
      const item = normalizeFteDeepFinding(rawItem, knownByCode.get(normalizeCnaeCode(rawItem?.cnae_codigo)));
      const cnaeCode = normalizeCnaeCode(item?.cnae_codigo);
      const baseCnae = knownByCode.get(cnaeCode) ?? {
        codigo: item?.cnae_codigo,
        descricao: item?.cnae_descricao,
        principal: item?.principal,
      };
      const deterministicMatch = matchFteCategoryForCnae(baseCnae);
      const hasReference = hasLegalReferenceSupport(item);
      const next = {
        ...item,
        obrigacoes: limitStringArray(item?.obrigacoes, 2),
        riscos_juridicos: limitStringArray(item?.riscos_juridicos, 2),
        recomendacoes_acao: limitStringArray(item?.recomendacoes_acao, 2),
        lacunas: limitStringArray(item?.lacunas, 3),
      };

      // Guardrail jurídico conservador: sem citação, manter nível médio quando houver aderência técnica.
      if (!hasReference && !hasGlobalCitations) {
        if (deterministicMatch) {
          next.risco = next.risco === "alto" ? "medio" : next.risco === "nao_classificado" || next.risco === "baixo" ? "medio" : next.risco;
          next.probabilidade_enquadramento =
            next.probabilidade_enquadramento === "alta" || next.probabilidade_enquadramento === "baixa" || next.probabilidade_enquadramento === "indefinida"
              ? "media"
              : next.probabilidade_enquadramento;
          if (!next.tese_enquadramento) {
            next.tese_enquadramento = `Aderência preliminar à Cat. ${deterministicMatch.category.id} (${deterministicMatch.category.name}); confirmação documental pendente.`;
          }
          if (next.ftes_relacionadas.length === 0) {
            const deterministicRef = buildDeterministicFteReference(deterministicMatch.category, deterministicMatch.matchType);
            if (deterministicRef) next.ftes_relacionadas = [deterministicRef];
          }
          next.lacunas = limitStringArray(
            [
              ...next.lacunas,
              "Sem citação verificável nesta execução; risco médio conservador mantido até validação técnico-jurídica.",
            ],
            3
          );
        } else {
          next.risco = "nao_classificado";
          next.probabilidade_enquadramento = "indefinida";
          next.lacunas = limitStringArray(
            [
              ...next.lacunas,
              "Sem citação verificável nesta execução; necessário parecer técnico-jurídico com FTE oficial.",
            ],
            3
          );
        }
      }

      // Guardrail de consistência: sem aderência determinística, reduzir confiança de classificações agressivas.
      if (!deterministicMatch && (next.risco === "alto" || next.probabilidade_enquadramento === "alta")) {
        next.risco = next.risco === "alto" ? "medio" : next.risco;
        next.probabilidade_enquadramento = next.probabilidade_enquadramento === "alta" ? "media" : next.probabilidade_enquadramento;
        next.lacunas = limitStringArray(
          [
            ...next.lacunas,
            "Classificação ajustada por consistência: sem aderência determinística clara no mapeamento CNAE x FTE.",
          ],
          3
        );
      }

      // Política conservadora: com aderência técnica mínima, evitar "não classificado".
      if (deterministicMatch && (next.risco === "nao_classificado" || next.risco === "baixo")) {
        next.risco = "medio";
        next.probabilidade_enquadramento =
          next.probabilidade_enquadramento === "indefinida" || next.probabilidade_enquadramento === "baixa"
            ? "media"
            : next.probabilidade_enquadramento;
        if (next.ftes_relacionadas.length === 0) {
          const deterministicRef = buildDeterministicFteReference(deterministicMatch.category, deterministicMatch.matchType);
          if (deterministicRef) next.ftes_relacionadas = [deterministicRef];
        }
        next.lacunas = limitStringArray(
          [
            ...next.lacunas,
            "Critério conservador aplicado: há aderência técnica preliminar, exigindo validação documental da FTE.",
          ],
          3
        );
      }

      if (next.risco !== "nao_classificado" && next.obrigacoes.length === 0) {
        next.obrigacoes = [
          "Formalizar enquadramento com base na FTE oficial e registrar parecer técnico-jurídico de suporte.",
        ];
      }

      return next;
    })
    .sort((a, b) => {
      if (Boolean(b.principal) !== Boolean(a.principal)) return Number(Boolean(b.principal)) - Number(Boolean(a.principal));
      return String(a.cnae_codigo ?? "").localeCompare(String(b.cnae_codigo ?? ""), "pt-BR");
    });

  const highRiskFindings = reviewedFindings.filter((item) => item.risco === "alto").length;
  const mediumRiskFindings = reviewedFindings.filter((item) => item.risco === "medio").length;
  const lowRiskFindings = reviewedFindings.filter((item) => item.risco === "baixo").length;

  return {
    executive_summary: trimText(sourceAnalysis?.executive_summary, 1600),
    findings: reviewedFindings,
    overall_recommendations: limitStringArray(sourceAnalysis?.overall_recommendations, 4),
    legal_risks: limitStringArray(sourceAnalysis?.legal_risks, 4),
    stats: {
      total_findings: reviewedFindings.length,
      high_risk_findings: highRiskFindings,
      medium_risk_findings: mediumRiskFindings,
      low_risk_findings: lowRiskFindings,
    },
  };
}

function matchFteCategoryForCnae(cnae) {
  const code = normalizeCnaeCode(cnae?.codigo);
  const prefix2 = code.slice(0, 2);
  const prefix3 = code.slice(0, 3);
  const description = normalizeText(cnae?.descricao);

  for (const category of FTE_CATEGORIES) {
    const matchedByPrefix = category.cnae_prefixes.some((prefix) => {
      const cleanPrefix = normalizeCnaeCode(prefix);
      return cleanPrefix && (code.startsWith(cleanPrefix) || prefix2 === cleanPrefix || prefix3 === cleanPrefix);
    });
    if (matchedByPrefix) {
      return { category, matchType: "prefix" };
    }
  }

  if (description) {
    for (const category of FTE_CATEGORIES) {
      const matchedByKeyword = category.keywords.some((keyword) => description.includes(normalizeText(keyword)));
      if (matchedByKeyword) {
        return { category, matchType: "keyword" };
      }
    }
  }

  return null;
}

function buildFteDeterministicFallbackAnalysis(cnaes, reason) {
  const items = Array.isArray(cnaes) ? cnaes : [];
  const findings = items.map((cnae) => {
    const match = matchFteCategoryForCnae(cnae);
    const category = match?.category;
    const isPrefixMatch = match?.matchType === "prefix";
    const isKeywordMatch = match?.matchType === "keyword";

    return normalizeFteDeepFinding(
      {
        cnae_codigo: cnae?.codigo ?? "",
        cnae_descricao: cnae?.descricao ?? "",
        principal: Boolean(cnae?.principal),
        risco: isPrefixMatch || isKeywordMatch ? "medio" : "nao_classificado",
        probabilidade_enquadramento: isPrefixMatch || isKeywordMatch ? "media" : "indefinida",
        tese_enquadramento: category
          ? `Pré-análise determinística indica aderência com Cat. ${category.id} (${category.name}) do CTF/APP; confirmar FTE específica com RAG/consulta oficial.`
          : "Sem aderência determinística clara para CNAE x FTE nesta execução.",
        obrigacoes: category
          ? [
              "Validar enquadramento na FTE especifica do IBAMA.",
              "Confirmar obrigação de inscrição no CTF/APP conforme atividade efetivamente exercida.",
            ]
          : [],
        riscos_juridicos: category
          ? [
              "Risco regulatório por subenquadramento ou enquadramento incompleto sem validação técnica.",
            ]
          : [],
        recomendacoes_acao: category
          ? [
              "Executar revisão técnica CNAE x FTE com evidências oficiais.",
              "Registrar racional de enquadramento e anexar FTEs citadas ao dossiê de compliance.",
            ]
          : ["Executar análise RAG/técnica para concluir o enquadramento com evidências."],
        lacunas: [
          `Análise RAG indisponível nesta tentativa (${reason || "motivo não informado"}).`,
          "Necessária confirmação da FTE específica com evidências textuais oficiais.",
        ],
        ftes_relacionadas: category
          ? [
              {
                codigo: String(category.id),
                titulo: `Cat. ${category.id} - ${category.name}`,
                categoria: category.name,
                justificativa:
                  match?.matchType === "prefix"
                    ? "Match preliminar por prefixo CNAE."
                    : "Match preliminar por similaridade textual da descrição.",
                url: "https://www.gov.br/ibama/pt-br/servicos/cadastros/ctf/ctf-app/ftes/ftes-por-categorias",
              },
            ]
          : [],
      },
      cnae
    );
  });

  const highRiskFindings = findings.filter((item) => item.risco === "alto").length;
  const mediumRiskFindings = findings.filter((item) => item.risco === "medio").length;
  const lowRiskFindings = findings.filter((item) => item.risco === "baixo").length;

  return {
    available: false,
    reason,
    fallback_mode: "deterministic_rule_fallback",
    executive_summary:
      "A análise profunda CNAE x FTE por RAG não foi concluída nesta tentativa. Foi aplicada pré-análise determinística para não deixar lacunas no painel, exigindo validação posterior com evidências RAG.",
    findings,
    overall_recommendations: [
      "Reexecutar o agente RAG para obter citações textuais das FTEs.",
      "Validar manualmente os CNAEs com maior aderência preliminar no portal oficial do IBAMA.",
    ],
    legal_risks: [
      "Conclusões desta etapa são preliminares quando o RAG está indisponível.",
    ],
    stats: {
      total_findings: findings.length,
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

function buildRagCnaeScope(cnaes, limitRaw = OPENAI_FTE_RAG_CNAE_LIMIT) {
  const items = Array.isArray(cnaes) ? cnaes : [];
  const safeLimit = Math.max(3, Math.min(20, Number.isFinite(limitRaw) ? limitRaw : 8));
  const deduped = [];
  const seen = new Set();
  for (const item of items) {
    const key = normalizeCnaeCode(item?.codigo);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }

  const scored = deduped.map((item, index) => {
    const match = matchFteCategoryForCnae(item);
    let score = Boolean(item?.principal) ? 100 : 0;
    if (match?.matchType === "prefix") score += 30;
    if (match?.matchType === "keyword") score += 20;
    return { item, index, score };
  });

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.index - b.index;
  });

  return {
    selected: scored.slice(0, safeLimit).map((entry) => entry.item),
    omitted: scored.slice(safeLimit).map((entry) => entry.item),
  };
}

async function generateFteDeepCnaeAnalysis({ company }) {
  const sourceId = "openai_fte_rag";
  const sourceConfig = resolveSourceConfig(sourceId, "OpenAI - Analise CNAE x FTE", 60000);
  const start = Date.now();
  const cnaes = Array.isArray(company?.cnaes) ? company.cnaes : [];

  if (!sourceConfig.enabled) {
    return {
      analysis: buildFteDeterministicFallbackAnalysis(cnaes, "feature_disabled"),
      source: normalizeSourcePayload(sourceId, "unavailable", {
        latencyMs: Date.now() - start,
        statusReason: "feature_disabled",
      }),
    };
  }

  if (!OPENAI_API_KEY) {
    const fallbackAnalysis = buildFteDeterministicFallbackAnalysis(cnaes, "OPENAI_API_KEY não configurada.");
    return {
      analysis: fallbackAnalysis,
      source: normalizeSourcePayload(sourceId, "unavailable", {
        latencyMs: Date.now() - start,
        statusReason: "missing_api_key",
        message: "Configure OPENAI_API_KEY para habilitar análise CNAE x FTE com RAG. Fallback determinístico aplicado nesta execução.",
      }),
    };
  }

  if (!OPENAI_FTE_VECTOR_STORE_ID) {
    const fallbackAnalysis = buildFteDeterministicFallbackAnalysis(cnaes, "OPENAI_FTE_VECTOR_STORE_ID não configurada.");
    return {
      analysis: fallbackAnalysis,
      source: normalizeSourcePayload(sourceId, "unavailable", {
        latencyMs: Date.now() - start,
        statusReason: "missing_vector_store",
        message: "Configure OPENAI_FTE_VECTOR_STORE_ID com o Vector Store das FTEs. Fallback determinístico aplicado nesta execução.",
      }),
    };
  }

  if (cnaes.length === 0) {
    const fallbackAnalysis = buildFteDeterministicFallbackAnalysis(cnaes, "Nenhum CNAE disponível para análise.");
    return {
      analysis: fallbackAnalysis,
      source: normalizeSourcePayload(sourceId, "not_found", {
        latencyMs: Date.now() - start,
        statusReason: "no_cnaes",
      }),
    };
  }

  const ragScope = buildRagCnaeScope(cnaes, OPENAI_FTE_RAG_CNAE_LIMIT);
  const cnaesForRag = ragScope.selected;
  const omittedCnaesCount = ragScope.omitted.length;
  const ragMaxOutputTokens = Math.max(
    1800,
    Math.min(6000, Number.isFinite(OPENAI_FTE_RAG_MAX_OUTPUT_TOKENS) ? OPENAI_FTE_RAG_MAX_OUTPUT_TOKENS : 3200)
  );

  const systemPrompt = [
    "Você atua como auditor ambiental e advogado regulatório sênior no Brasil.",
    "Analise o encaixe dos CNAEs priorizados nas FTEs do IBAMA usando exclusivamente evidências recuperadas pela ferramenta file_search.",
    "Não invente fatos, não invente normas e não afirme correspondências sem lastro nos arquivos consultados.",
    "Priorize apontar fronteiras de enquadramento: o que entra, o que não entra, linhas de corte, obrigações e riscos jurídicos.",
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
    "Seja extremamente conciso: no máximo 1 item por lista (obrigacoes, riscos_juridicos, recomendacoes_acao, lacunas) e no máximo 140 caracteres por campo textual longo.",
    "Use no máximo 1 FTE relacionada por CNAE.",
    "Se não houver citação textual direta, mas houver aderência técnica por prefixo/descrição do CNAE com categoria FTE, classifique no mínimo como risco 'medio' e declare lacunas.",
    "Use risco 'nao_classificado' apenas quando não houver aderência técnica mínima identificável.",
  ].join("\n");

  const userPrompt = `Empresa alvo para análise CNAE x FTE:\n\n${JSON.stringify(
    {
      cnpj: company?.cnpj ?? null,
      razao_social: company?.razao_social ?? null,
      nome_fantasia: company?.nome_fantasia ?? null,
      cnaes_priorizados_para_rag: cnaesForRag,
      cnaes_fora_do_escopo_nesta_execucao: omittedCnaesCount,
    },
    null,
    2
  )}`;

  const requestPayload = {
    model: OPENAI_FTE_MODEL,
    temperature: Math.max(0, Math.min(0.2, Number.isFinite(OPENAI_FTE_RAG_TEMPERATURE) ? OPENAI_FTE_RAG_TEMPERATURE : 0)),
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
    max_output_tokens: ragMaxOutputTokens,
  };

  const runFteOpenAiRequest = (payloadInput, timeoutMs) =>
    fetchWithTimeout("https://api.openai.com/v1/responses", timeoutMs, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify(payloadInput),
    });

  const configuredPrimaryTimeout =
    Number.isFinite(OPENAI_FTE_RAG_TIMEOUT_MS) && OPENAI_FTE_RAG_TIMEOUT_MS > 0 ? OPENAI_FTE_RAG_TIMEOUT_MS : sourceConfig.timeoutMs;
  const primaryTimeout = Math.min(30000, Math.max(5000, Number.isFinite(configuredPrimaryTimeout) ? configuredPrimaryTimeout : 18000));
  const configuredRetryTimeout = Number.isFinite(OPENAI_FTE_RAG_RETRY_TIMEOUT_MS) ? OPENAI_FTE_RAG_RETRY_TIMEOUT_MS : 0;
  const retryTimeout =
    configuredRetryTimeout > primaryTimeout
      ? Math.min(45000, Math.max(primaryTimeout + 1000, configuredRetryTimeout))
      : primaryTimeout;

  let response = await runFteOpenAiRequest(requestPayload, primaryTimeout);
  let retryUsed = false;
  if (!response && retryTimeout > primaryTimeout) {
    retryUsed = true;
    response = await runFteOpenAiRequest(requestPayload, retryTimeout);
  }

  if (!response) {
    const fallbackAnalysis = buildFteDeterministicFallbackAnalysis(cnaes, "timeout_or_network");
    return {
      analysis: fallbackAnalysis,
      source: normalizeSourcePayload(sourceId, "unavailable", {
        latencyMs: Date.now() - start,
        statusReason: retryUsed ? "timeout_or_network_after_retry" : "timeout_or_network",
        message: retryUsed
          ? `OpenAI não respondeu após tentativa principal (${primaryTimeout} ms) e retry (${retryTimeout} ms); fallback determinístico aplicado.`
          : `OpenAI não respondeu dentro do orçamento de ${primaryTimeout} ms; fallback determinístico aplicado.`,
      }),
    };
  }

  if (!response.ok) {
    const errorPayload = await parseJsonResponse(response);
    const errorDetail = pickString(errorPayload?.error?.message ?? errorPayload?.message ?? errorPayload?.detail);
    const fallbackAnalysis = buildFteDeterministicFallbackAnalysis(
      cnaes,
      errorDetail ? `OpenAI HTTP ${response.status}: ${errorDetail}` : `OpenAI HTTP ${response.status}`
    );
    return {
      analysis: fallbackAnalysis,
      source: normalizeSourcePayload(sourceId, "error", {
        latencyMs: Date.now() - start,
        statusReason: `http_${response.status}`,
        message: errorDetail
          ? `OpenAI retornou ${response.status}: ${errorDetail}. Fallback determinístico aplicado.`
          : `OpenAI retornou ${response.status}. Fallback determinístico aplicado.`,
      }),
    };
  }

  const payload = await parseJsonResponse(response);
  const outputText = extractOpenAiResponseText(payload);
  if (!outputText) {
    const fallbackAnalysis = buildFteDeterministicFallbackAnalysis(cnaes, "Resposta da OpenAI sem conteúdo textual.");
    return {
      analysis: fallbackAnalysis,
      source: normalizeSourcePayload(sourceId, "error", {
        latencyMs: Date.now() - start,
        statusReason: "invalid_payload",
        message: "OpenAI respondeu sem texto útil; fallback determinístico aplicado.",
      }),
    };
  }

  let parsedObject = parseJsonObjectFromText(outputText);
  let effectiveOutputText = outputText;
  const citations = extractOpenAiFileCitations(payload);
  const inputTokens = Number(payload?.usage?.input_tokens ?? payload?.usage?.prompt_tokens);
  const outputTokens = Number(payload?.usage?.output_tokens ?? payload?.usage?.completion_tokens);
  const tokenCapReached =
    Number.isFinite(outputTokens) && Number.isFinite(requestPayload.max_output_tokens)
      ? outputTokens >= Number(requestPayload.max_output_tokens) - 15
      : false;

  if (!parsedObject && tokenCapReached && cnaesForRag.length > 3) {
    const compactSystemPrompt = `${systemPrompt}\nRetorne JSON compacto e válido, sem markdown e sem texto fora do objeto JSON.`;
    const compactUserPrompt = `Reprocessar apenas os CNAEs de maior materialidade para evitar truncamento.\n\n${JSON.stringify(
      {
        cnpj: company?.cnpj ?? null,
        razao_social: company?.razao_social ?? null,
        cnaes_priorizados_para_rag: cnaesForRag.slice(0, 3),
        modo_recuperacao: "truncation_recovery",
      },
      null,
      2
    )}`;
    const compactPayload = {
      ...requestPayload,
      max_output_tokens: Math.max(1400, Math.floor(ragMaxOutputTokens * 0.7)),
      input: [
        { role: "system", content: [{ type: "input_text", text: compactSystemPrompt }] },
        { role: "user", content: [{ type: "input_text", text: compactUserPrompt }] },
      ],
    };
    const compactResponse = await runFteOpenAiRequest(compactPayload, Math.max(12000, primaryTimeout - 2000));
    if (compactResponse?.ok) {
      const compactPayloadResponse = await parseJsonResponse(compactResponse);
      const compactOutputText = extractOpenAiResponseText(compactPayloadResponse);
      const compactParsed = parseJsonObjectFromText(compactOutputText);
      if (compactParsed) {
        parsedObject = compactParsed;
        effectiveOutputText = compactOutputText;
        const compactCitations = extractOpenAiFileCitations(compactPayloadResponse);
        for (const citation of compactCitations) {
          const key = `${citation?.file_id ?? ""}|${citation?.filename ?? ""}|${citation?.quote ?? ""}`;
          const already = citations.some(
            (current) => `${current?.file_id ?? ""}|${current?.filename ?? ""}|${current?.quote ?? ""}` === key
          );
          if (!already) citations.push(citation);
        }
      }
    }
  }

  if (!parsedObject) {
    const fallbackAnalysis = buildFteDeterministicFallbackAnalysis(
      cnaes,
      tokenCapReached ? "output_truncated_at_max_tokens" : "invalid_or_unstructured_openai_output"
    );
    return {
      analysis: {
        ...fallbackAnalysis,
        model: OPENAI_FTE_MODEL,
        vector_store_id: OPENAI_FTE_VECTOR_STORE_ID,
        scope: {
          total_cnaes: cnaes.length,
          rag_selected_cnaes: cnaesForRag.length,
          rag_omitted_cnaes: omittedCnaesCount,
        },
        ...(Number.isFinite(inputTokens) ? { input_tokens: inputTokens } : {}),
        ...(Number.isFinite(outputTokens) ? { output_tokens: outputTokens } : {}),
        generated_at: new Date().toISOString(),
        parse_warning: tokenCapReached
          ? "IA atingiu limite de tokens e retornou JSON truncado; escopo RAG foi priorizado e fallback determinístico aplicado."
          : "IA retornou payload não parseável; fallback determinístico aplicado.",
      },
      source: normalizeSourcePayload(sourceId, "error", {
        latencyMs: Date.now() - start,
        statusReason: tokenCapReached ? "output_truncated" : "invalid_payload",
        message: tokenCapReached
          ? "OpenAI retornou JSON truncado por limite de tokens no escopo priorizado; fallback determinístico aplicado."
          : "OpenAI retornou conteúdo não estruturado; fallback determinístico aplicado.",
        evidenceCount: Math.max(citations.length, Number(fallbackAnalysis?.stats?.total_findings ?? 0), 1),
      }),
    };
  }

  const normalized = normalizeFteDeepAnalysisPayload(parsedObject, cnaes, effectiveOutputText);
  const reviewed = applyLegalStabilityGuards({
    analysis: normalized,
    cnaes,
    citations,
  });
  const analysis = {
    available: true,
    ...reviewed,
    citations,
    model: OPENAI_FTE_MODEL,
    vector_store_id: OPENAI_FTE_VECTOR_STORE_ID,
    scope: {
      total_cnaes: cnaes.length,
      rag_selected_cnaes: cnaesForRag.length,
      rag_omitted_cnaes: omittedCnaesCount,
    },
    ...(Number.isFinite(inputTokens) ? { input_tokens: inputTokens } : {}),
    ...(Number.isFinite(outputTokens) ? { output_tokens: outputTokens } : {}),
    generated_at: new Date().toISOString(),
    ...(parsedObject ? {} : { parse_warning: "IA retornou texto não estruturado; aplicado fallback parcial." }),
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
        obrigacao: "Inscrição no CTF/APP obrigatória. Verificar FTE específica para confirmar enquadramento.",
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
        obrigacao: "Possível enquadramento por descrição. Consultar FTE para confirmação.",
        risco: "medio",
      });
    }
  }

  return {
    enquadrado: results.length > 0,
    matches: results,
    nota: "A CNAE é referência, não determinante. O enquadramento final depende da análise da FTE específica (IN Ibama nº 13/2021).",
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
      tipo: "Anexo 5 - Fonte de Poluição",
      obrigacao: "Licenciamento Ambiental obrigatório (LP, LI, LO) conforme Art. 58 do Regulamento da Lei 997/76",
      risco: "alto",
      legislacao: ["Lei Estadual nº 997/76", "Decreto nº 8.468/76", "Decreto nº 47.397/02"],
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
        ? "Atenção: Algumas atividades podem ter restrições na RMSP (Lei Estadual nº 1.817/78) e em áreas de drenagem do Rio Piracicaba (Lei 9.825/97)."
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
        enquadramento: "Deliberação CONSEMA 01/2024 - Impacto Local",
        competencia: "Municipal (se município habilitado) ou CETESB",
        risco: "medio",
      });
      continue;
    }

    const nonIndustrial = [
      { pattern: /^41|^42|^43/, desc: "Construção civil / obras" },
      { pattern: /^55|^56/, desc: "Alojamento e alimentação" },
      { pattern: /^86|^87|^88/, desc: "Saúde" },
      { pattern: /^47/, desc: "Comércio varejista" },
      { pattern: /^49|^50|^51|^52/, desc: "Transporte e armazenamento" },
    ];

    const match = nonIndustrial.find((entry) => entry.pattern.test(code));
    if (!match) continue;

    results.push({
      cnae: cnae.codigo,
      descricao: cnae.descricao || match.desc,
      enquadramento: "Verificar Anexo I, item I da DN CONSEMA 01/2024 (atividades não industriais)",
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
    nota: "A competência depende da habilitação do município junto ao CONSEMA. Se não habilitado, a CETESB assume o licenciamento.",
  };
}

function agentStateNational(cnaes, uf) {
  const normalizedUf = String(uf ?? "").trim().toUpperCase();
  if (normalizedUf === "SP") {
    const details = agentCETESB(cnaes);
    return {
      scope: "estadual",
      uf: normalizedUf,
      mode: "api_ready",
      source_id: "sp_cetesb_licenciamento",
      available: true,
      details,
      obligations: normalizeStringArray(
        details?.matches?.map((item) => item?.obrigacao).filter(Boolean)
      ),
      nota:
        details?.matches?.length > 0
          ? "Regras estaduais de SP aplicadas automaticamente (CETESB)."
          : "Sem gatilhos estaduais automáticos em SP na execução atual.",
    };
  }

  return {
    scope: "estadual",
    uf: normalizedUf || null,
    mode: "manual_required",
    source_id: normalizedUf ? `estadual_licenciamento_${normalizedUf.toLowerCase()}` : "estadual_licenciamento_default",
    available: false,
    details: {
      enquadrado: false,
      matches: [],
      lp_precedente: false,
      rmsp_restricoes: false,
      nota_rmsp: null,
      links: {
        atividades: "",
        tabela_atividades: "",
        portal_licenciamento: "",
      },
    },
    obligations: [
      "Executar checklist assistido junto ao órgão ambiental estadual competente.",
      "Validar tipologia da atividade e rito de licenciamento na norma estadual vigente.",
    ],
    nota: "UF sem conector estadual estruturado nesta versão. Fluxo assistido com evidências e trilha de auditoria.",
  };
}

function agentMunicipalNational(cnaes, uf, municipioNome) {
  const normalizedUf = String(uf ?? "").trim().toUpperCase();
  if (normalizedUf === "SP") {
    const details = agentMunicipal(cnaes);
    return {
      scope: "municipal",
      uf: normalizedUf,
      municipio_nome: municipioNome ?? null,
      mode: "api_ready",
      source_id: "sp_consema_municipal",
      available: true,
      details,
      obligations: normalizeStringArray(
        details?.matches?.map((item) => item?.enquadramento).filter(Boolean)
      ),
      nota:
        details?.matches?.length > 0
          ? "Tipologia municipal de SP aplicada automaticamente (LC 140/2011 + DN CONSEMA 01/2024)."
          : "Sem gatilhos municipais automáticos em SP na execução atual.",
    };
  }

  return {
    scope: "municipal",
    uf: normalizedUf || null,
    municipio_nome: municipioNome ?? null,
    mode: "manual_required",
    source_id: "municipal_licenciamento_generico",
    available: false,
    details: {
      enquadrado: false,
      matches: [],
      legislacao: {
        lc140: "https://www.planalto.gov.br/ccivil_03/leis/LCP/Lcp140.htm",
        consema: "",
        municipios_habilitados: "",
      },
      nota:
        "Município sem conector estruturado nesta versão. Consulta assistida em portal oficial local.",
    },
    obligations: [
      "Confirmar competência do ente licenciador (municipal x estadual).",
      "Mapear requisitos locais de LP/LI/LO e condicionantes urbanístico-ambientais.",
    ],
    nota: "Fluxo municipal assistido por checklist com trilha auditável.",
  };
}

function escapeArcGisSqlLike(value) {
  return String(value ?? "")
    .replace(/'/g, "''")
    .replace(/%/g, "")
    .replace(/_/g, "")
    .trim();
}

function normalizeForLikeToken(value) {
  const tokens = normalizeText(value).split(/\s+/).filter((token) => token.length >= 4);
  return tokens[0] ?? "";
}

function buildSemilMapUrls(company, bestMatch = null) {
  const params = new URLSearchParams({
    id: SEMIL_AREAS_CONTAMINADAS_APP_ID,
  });

  const socialName = String(company?.razao_social ?? company?.nome_fantasia ?? "")
    .trim()
    .slice(0, 140);
  if (socialName) {
    params.set("find", socialName);
  }

  const lon = Number(bestMatch?.longitude);
  const lat = Number(bestMatch?.latitude);
  if (Number.isFinite(lon) && Number.isFinite(lat)) {
    params.set("marker", `${lon},${lat}`);
  }

  const url = `https://mapas.semil.sp.gov.br/portal/apps/webappviewer/index.html?${params.toString()}`;
  return {
    official_map_embed_url: url,
    official_map_open_url: url,
  };
}

function toSemilMatch({
  feature,
  layerId,
  layerName,
  strategy,
  score,
}) {
  const attrs = feature?.attributes && typeof feature.attributes === "object" ? feature.attributes : {};
  const risco = score >= 0.9 ? "alto" : score >= 0.65 ? "medio" : "baixo";
  return {
    match_id: hashObject({
      layerId,
      strategy,
      nis: attrs.NIS ?? attrs.OBJECTID ?? attrs.NumSipolText ?? "",
      empreendimento: attrs.NomeEmpree ?? "",
    }),
    layer_id: layerId,
    layer_name: layerName,
    strategy,
    score,
    risco,
    empreendimento: pickString(attrs.NomeEmpree),
    atividade: pickString(attrs.AtividadeSipol),
    classificacao: pickString(attrs.ClassificacaoAtual),
    endereco: pickString(attrs.DesEndereco),
    municipio: pickString(attrs.NomMunicipio),
    cep: pickString(attrs.CEP),
    nis: pickString(attrs.NIS ?? attrs.NumSipolText),
    sigla_dg: pickString(attrs.Sigla_DG),
    latitude:
      Number.isFinite(Number(feature?.geometry?.y)) ? Number(feature.geometry.y) : null,
    longitude:
      Number.isFinite(Number(feature?.geometry?.x)) ? Number(feature.geometry.x) : null,
  };
}

async function querySemilLayer({ layerId, where, outFields, timeoutMs }) {
  const params = new URLSearchParams({
    where,
    outFields,
    f: "json",
    returnGeometry: "true",
    resultRecordCount: "100",
  });
  const endpoint = `${SEMIL_AREAS_CONTAMINADAS_SERVICE_BASE}/${layerId}/query?${params.toString()}`;
  const response = await fetchWithTimeout(endpoint, timeoutMs, {
    headers: { accept: "application/json" },
  });

  if (!response) return { status: "unavailable", features: [] };
  if (!response.ok) return { status: "error", features: [] };

  const payload = await parseJsonResponse(response);
  if (!payload || typeof payload !== "object" || payload?.error) {
    return { status: "error", features: [] };
  }

  return {
    status: "success",
    features: Array.isArray(payload?.features) ? payload.features : [],
  };
}

async function agentAreasContaminadasNational(company, uf) {
  const normalizedUf = String(uf ?? "").trim().toUpperCase();
  const commonPayload = buildSemilMapUrls(company);

  if (normalizedUf !== "SP") {
    return {
      result: {
        available: false,
        method: "manual_required",
        status: "manual_required",
        summary: "Consulta automática de áreas contaminadas não disponível para esta UF nesta versão.",
        matches: [],
        evidence_refs: [],
        limitations: [
          "Conector geoespacial oficial ainda não integrado para esta UF.",
          "Executar diligência assistida em portais oficiais estaduais/municipais.",
        ],
        ...commonPayload,
      },
      source: normalizeSourcePayload("areas_contaminadas_manual_nacional", "not_found", {
        latencyMs: 0,
        statusReason: "manual_required",
        evidenceCount: 0,
      }),
    };
  }

  const sourceId = "sp_semil_areas_contaminadas_api";
  const sourceConfig = resolveSourceConfig(sourceId, "SEMIL/CETESB - Áreas Contaminadas (SP)", 15000);
  const start = Date.now();
  const targetCep = normalizeCep(company?.cep);
  const normalizedRazao = normalizeText(company?.razao_social);
  const normalizedEndereco = normalizeText(company?.logradouro || company?.endereco);
  const normalizedMunicipio = normalizeText(company?.municipio);
  const normalizedBairro = normalizeText(company?.bairro);
  const outFields = [
    "OBJECTID",
    "NIS",
    "NumSipolText",
    "NomeEmpree",
    "AtividadeSipol",
    "ClassificacaoAtual",
    "DesEndereco",
    "NomMunicipio",
    "NomBairro",
    "CEP",
    "Sigla_DG",
  ].join(",");

  const layerNames = {
    1: "Áreas Contaminadas e Reabilitadas - Geral (Pontos)",
    2: "Áreas Contaminadas e Reabilitadas - Geral (Poligonos)",
  };

  const collected = [];
  const statusBag = [];

  const pushMatches = (items) => {
    for (const item of items) {
      collected.push(item);
    }
  };

  for (const layerId of SEMIL_AREAS_LAYER_IDS) {
    if (targetCep.length >= 5) {
      const cepPrefix = escapeArcGisSqlLike(targetCep.slice(0, 5));
      const cepQuery = await querySemilLayer({
        layerId,
        where: `CEP LIKE '%${cepPrefix}%'`,
        outFields,
        timeoutMs: sourceConfig.timeoutMs,
      });
      statusBag.push(cepQuery.status);
      const cepMatches = cepQuery.features
        .filter((feature) => normalizeCep(feature?.attributes?.CEP) === targetCep)
        .map((feature) =>
          toSemilMatch({
            feature,
            layerId,
            layerName: layerNames[layerId],
            strategy: "cep",
            score: 0.95,
          })
        );
      pushMatches(cepMatches);
    }

    const razaoToken = normalizeForLikeToken(normalizedRazao);
    if (razaoToken) {
      const upperToken = escapeArcGisSqlLike(razaoToken.toUpperCase());
      const razaoQuery = await querySemilLayer({
        layerId,
        where: `UPPER(NomeEmpree) LIKE '%${upperToken}%'`,
        outFields,
        timeoutMs: sourceConfig.timeoutMs,
      });
      statusBag.push(razaoQuery.status);
      const razaoMatches = razaoQuery.features
        .filter((feature) => normalizeText(feature?.attributes?.NomeEmpree).includes(razaoToken))
        .map((feature) =>
          toSemilMatch({
            feature,
            layerId,
            layerName: layerNames[layerId],
            strategy: "razao_social",
            score: 0.78,
          })
        );
      pushMatches(razaoMatches);
    }

    const enderecoToken = normalizeForLikeToken(normalizedEndereco);
    if (enderecoToken) {
      const upperToken = escapeArcGisSqlLike(enderecoToken.toUpperCase());
      const enderecoQuery = await querySemilLayer({
        layerId,
        where: `UPPER(DesEndereco) LIKE '%${upperToken}%'`,
        outFields,
        timeoutMs: sourceConfig.timeoutMs,
      });
      statusBag.push(enderecoQuery.status);
      const enderecoMatches = enderecoQuery.features
        .filter((feature) => {
          const address = normalizeText(feature?.attributes?.DesEndereco);
          if (!address.includes(enderecoToken)) return false;
          if (!normalizedMunicipio) return true;
          const city = normalizeText(feature?.attributes?.NomMunicipio);
          return city.includes(normalizedMunicipio) || normalizedMunicipio.includes(city);
        })
        .map((feature) =>
          toSemilMatch({
            feature,
            layerId,
            layerName: layerNames[layerId],
            strategy: "endereco",
            score: 0.62,
          })
        );
      pushMatches(enderecoMatches);
    }

    if (normalizedMunicipio && normalizedBairro) {
      const upperMunicipio = escapeArcGisSqlLike(normalizedMunicipio.toUpperCase());
      const municipalQuery = await querySemilLayer({
        layerId,
        where: `UPPER(NomMunicipio) = '${upperMunicipio}'`,
        outFields,
        timeoutMs: sourceConfig.timeoutMs,
      });
      statusBag.push(municipalQuery.status);
      const municipalMatches = municipalQuery.features
        .filter((feature) => {
          const bairro = normalizeText(feature?.attributes?.NomBairro);
          if (!bairro) return false;
          return bairro.includes(normalizedBairro) || normalizedBairro.includes(bairro);
        })
        .map((feature) =>
          toSemilMatch({
            feature,
            layerId,
            layerName: layerNames[layerId],
            strategy: "municipio_bairro",
            score: 0.45,
          })
        );
      pushMatches(municipalMatches);
    }
  }

  const deduped = new Map();
  for (const match of collected) {
    const key = `${match.layer_id}|${match.nis ?? ""}|${normalizeText(match.empreendimento)}`;
    const current = deduped.get(key);
    if (!current || Number(match.score ?? 0) > Number(current.score ?? 0)) {
      deduped.set(key, match);
    }
  }
  const matches = [...deduped.values()].sort((a, b) => Number(b.score ?? 0) - Number(a.score ?? 0));

  const hadSuccess = statusBag.includes("success");
  const hadErrorOnly = statusBag.length > 0 && !hadSuccess;
  const sourceStatus = hadSuccess ? "success" : hadErrorOnly ? "error" : "unavailable";

  const source = normalizeSourcePayload(sourceId, sourceStatus, {
    latencyMs: Date.now() - start,
    statusReason: hadSuccess ? "ok" : hadErrorOnly ? "query_error" : "timeout_or_network",
    evidenceCount: matches.length,
    ...(hadSuccess
      ? {}
      : {
          message: "Não foi possível concluir consulta automática nas camadas SEMIL/CETESB nesta execução.",
        }),
  });

  return {
    result: {
      available: hadSuccess,
      method: hadSuccess ? "api_match" : "manual_required",
      status: hadSuccess ? (matches.length > 0 ? "match_found" : "not_found") : "manual_required",
      summary: hadSuccess
        ? matches.length > 0
          ? `${matches.length} match(es) identificado(s) na base oficial de áreas contaminadas de SP.`
          : "Nenhum match encontrado na base oficial de áreas contaminadas de SP."
        : "Consulta automática indisponível nesta execução; seguir com diligência manual assistida.",
      matches,
      evidence_refs: matches.map((item) => item.match_id),
      limitations: [
        "Matching por texto e endereço pode gerar falsos positivos/negativos em nomes similares.",
        "A decisão final deve considerar validação técnica-jurídica e consulta visual no mapa oficial.",
      ],
      ...buildSemilMapUrls(company, matches[0] ?? null),
    },
    source,
  };
}

function countRisk(matches, level) {
  if (!Array.isArray(matches)) return 0;
  return matches.filter((item) => String(item?.risco ?? "") === level).length;
}

function extractStateMatches(state) {
  return Array.isArray(state?.details?.matches) ? state.details.matches : [];
}

function extractMunicipalMatches(municipal) {
  return Array.isArray(municipal?.details?.matches) ? municipal.details.matches : [];
}

function classifyComplianceRisk({ fteDeepAnalysis, ibama, state, municipal, areasContaminadas }) {
  const stateMatches = extractStateMatches(state);
  const municipalMatches = extractMunicipalMatches(municipal);
  const areaMatches = Array.isArray(areasContaminadas?.matches) ? areasContaminadas.matches : [];

  const highCount =
    countRisk(fteDeepAnalysis?.findings, "alto") +
    countRisk(ibama?.matches, "alto") +
    countRisk(stateMatches, "alto") +
    countRisk(municipalMatches, "alto") +
    countRisk(areaMatches, "alto");
  const mediumCount =
    countRisk(fteDeepAnalysis?.findings, "medio") +
    countRisk(ibama?.matches, "medio") +
    countRisk(stateMatches, "medio") +
    countRisk(municipalMatches, "medio") +
    countRisk(areaMatches, "medio");

  if (highCount >= 3 || (highCount >= 1 && mediumCount >= 3)) return "alto";
  if (highCount >= 1 || mediumCount >= 2) return "medio";
  return "baixo";
}

function buildEnvironmentalAiPromptInput({
  company,
  jurisdictionContext,
  fteDeepAnalysis,
  federal,
  state,
  municipal,
  areasContaminadas,
  govbrContext,
  coverage,
  evidence,
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
      municipio: company?.municipio ?? null,
      uf: company?.uf ?? null,
      cnaes: Array.isArray(company?.cnaes) ? company.cnaes : [],
    },
    jurisdiction_context: jurisdictionContext ?? null,
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
    federal: {
      achados: federal ?? null,
      ibama: federal?.ibama ?? null,
      obrigacoes: Array.isArray(federal?.obligations) ? federal.obligations : [],
    },
    state: state ?? null,
    municipal: municipal ?? null,
    areas_contaminadas: {
      available: Boolean(areasContaminadas?.available),
      method: areasContaminadas?.method ?? null,
      status: areasContaminadas?.status ?? null,
      summary: areasContaminadas?.summary ?? null,
      matches: Array.isArray(areasContaminadas?.matches) ? areasContaminadas.matches : [],
      limitations: Array.isArray(areasContaminadas?.limitations) ? areasContaminadas.limitations : [],
      official_map_open_url: areasContaminadas?.official_map_open_url ?? null,
    },
    govbr_context: govbrContext ?? null,
    coverage: coverage ?? null,
    evidence: Array.isArray(evidence) ? evidence : [],
    sources: Array.isArray(sources) ? sources : [],
  };
}

async function generateEnvironmentalAiReport({
  company,
  jurisdictionContext,
  fteDeepAnalysis,
  federal,
  state,
  municipal,
  areasContaminadas,
  govbrContext,
  coverage,
  evidence,
  summary,
  sources,
}) {
  const sourceId = "openai_relatorio_ambiental";
  const sourceConfig = resolveSourceConfig(sourceId, "OpenAI - Relatório Ambiental", 45000);
  const start = Date.now();
  const configuredReportTimeout =
    Number.isFinite(OPENAI_RELATORIO_TIMEOUT_MS) && OPENAI_RELATORIO_TIMEOUT_MS > 0
      ? OPENAI_RELATORIO_TIMEOUT_MS
      : sourceConfig.timeoutMs;
  const reportTimeoutMs = Math.min(30000, Math.max(5000, Number.isFinite(configuredReportTimeout) ? configuredReportTimeout : 15000));

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
        reason: "OPENAI_API_KEY não configurada.",
      },
      source: normalizeSourcePayload(sourceId, "unavailable", {
        latencyMs: Date.now() - start,
        statusReason: "missing_api_key",
        message: "Configure OPENAI_API_KEY para habilitar o último agente (relatório IA).",
      }),
    };
  }

  const promptInput = buildEnvironmentalAiPromptInput({
    company,
    jurisdictionContext,
    fteDeepAnalysis,
    federal,
    state,
    municipal,
    areasContaminadas,
    govbrContext,
    coverage,
    evidence,
    summary,
    sources,
  });

  const sectionPlans = [
    {
      id: "core_1_4",
      headings: [
        "1) Resumo Executivo",
        "2) Perfil e CNAEs",
        "3) Achados Profundos CNAE x FTE (RAG)",
        "4) Achados Regulatórios (Federal, Estadual, Municipal e Territorial)",
      ],
      maxTokens: 900,
      preferredTimeoutMs: Math.round(reportTimeoutMs * 0.55),
      payload: {
        company: promptInput.company,
        jurisdiction_context: promptInput.jurisdiction_context,
        summary: promptInput.summary,
        fte_deep_analysis: promptInput.fte_deep_analysis,
        federal: promptInput.federal,
        state: promptInput.state,
        municipal: promptInput.municipal,
        areas_contaminadas: promptInput.areas_contaminadas,
      },
    },
    {
      id: "ops_5_8",
      headings: [
        "5) Contratações Públicas (gov.br)",
        "6) Plano de Ação Prioritário (30-60-90 dias)",
        "7) Checklist de Evidências para Auditoria",
        "8) Disclaimer Técnico",
      ],
      maxTokens: 800,
      preferredTimeoutMs: Math.round(reportTimeoutMs * 0.45),
      payload: {
        company: {
          cnpj: promptInput?.company?.cnpj ?? null,
          razao_social: promptInput?.company?.razao_social ?? null,
          endereco: promptInput?.company?.endereco ?? null,
        },
        govbr_context: promptInput.govbr_context,
        coverage: promptInput.coverage,
        summary: promptInput.summary,
        evidence: Array.isArray(promptInput.evidence) ? promptInput.evidence.slice(0, 60) : [],
        sources: Array.isArray(promptInput.sources) ? promptInput.sources : [],
        areas_contaminadas: {
          method: promptInput?.areas_contaminadas?.method ?? null,
          status: promptInput?.areas_contaminadas?.status ?? null,
          limitations: Array.isArray(promptInput?.areas_contaminadas?.limitations)
            ? promptInput.areas_contaminadas.limitations
            : [],
        },
      },
    },
  ];

  const deadline = Date.now() + reportTimeoutMs;
  const sectionResults = [];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  for (const section of sectionPlans) {
    const remainingMs = deadline - Date.now();
    if (remainingMs < 4_500) {
      sectionResults.push({
        id: section.id,
        ok: false,
        status_reason: "budget_exhausted",
        message: "Orçamento de tempo esgotado antes desta etapa.",
      });
      continue;
    }

    const sectionTimeoutMs = Math.max(4_500, Math.min(remainingMs - 250, section.preferredTimeoutMs));
    const sectionSystemPrompt = [
      "Você é um especialista sênior em compliance ambiental no Brasil.",
      "Produza parecer técnico-jurídico em português do Brasil, objetivo e auditável.",
      "Use SOMENTE os dados estruturados fornecidos; não invente fatos.",
      "Retorne APENAS as seções solicitadas, com títulos idênticos.",
      "Se faltar dado, declare explicitamente a limitação.",
    ].join("\n");

    const sectionUserPrompt = [
      `Gerar somente as seções: ${section.headings.join(" | ")}`,
      "Dados estruturados:",
      JSON.stringify(section.payload, null, 2),
    ].join("\n\n");

    const response = await fetchWithTimeout("https://api.openai.com/v1/chat/completions", sectionTimeoutMs, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        temperature: 0,
        max_tokens: section.maxTokens,
        messages: [
          { role: "system", content: sectionSystemPrompt },
          { role: "user", content: sectionUserPrompt },
        ],
      }),
    });

    if (!response) {
      sectionResults.push({
        id: section.id,
        ok: false,
        status_reason: "timeout_or_network",
        message: `OpenAI não respondeu na etapa ${section.id} dentro de ${sectionTimeoutMs} ms.`,
      });
      continue;
    }

    if (!response.ok) {
      const errorPayload = await parseJsonResponse(response);
      const errorDetail = pickString(errorPayload?.error?.message ?? errorPayload?.message ?? errorPayload?.detail);
      sectionResults.push({
        id: section.id,
        ok: false,
        status_reason: `http_${response.status}`,
        message: errorDetail ? `HTTP ${response.status}: ${errorDetail}` : `HTTP ${response.status}`,
      });
      continue;
    }

    const payload = await parseJsonResponse(response);
    const narrative = pickString(payload?.choices?.[0]?.message?.content);
    if (!narrative) {
      sectionResults.push({
        id: section.id,
        ok: false,
        status_reason: "invalid_payload",
        message: "Resposta sem conteúdo textual na etapa.",
      });
      continue;
    }

    const inputTokens = Number(payload?.usage?.prompt_tokens);
    const outputTokens = Number(payload?.usage?.completion_tokens);
    if (Number.isFinite(inputTokens)) totalInputTokens += inputTokens;
    if (Number.isFinite(outputTokens)) totalOutputTokens += outputTokens;

    sectionResults.push({
      id: section.id,
      ok: true,
      text: narrative.trim(),
    });
  }

  const successfulSections = sectionResults.filter((section) => section.ok && pickString(section.text));
  if (successfulSections.length === 0) {
    const firstFailure = sectionResults.find((section) => !section.ok);
    return {
      analysis: {
        available: false,
        reason: firstFailure?.status_reason || "timeout_or_network",
      },
      source: normalizeSourcePayload(sourceId, "unavailable", {
        latencyMs: Date.now() - start,
        statusReason: firstFailure?.status_reason || "timeout_or_network",
        message: firstFailure?.message || `OpenAI não respondeu dentro do orçamento de ${reportTimeoutMs} ms.`,
      }),
    };
  }

  const sectionMap = new Map(successfulSections.map((section) => [section.id, section.text]));
  const narrative = [
    sectionMap.get("core_1_4") ||
      [
        "## 1) Resumo Executivo",
        "Seção não concluída no orçamento de tempo desta execução.",
        "",
        "## 2) Perfil e CNAEs",
        "Seção não concluída no orçamento de tempo desta execução.",
        "",
        "## 3) Achados Profundos CNAE x FTE (RAG)",
        "Seção não concluída no orçamento de tempo desta execução.",
        "",
        "## 4) Achados Regulatórios (Federal, Estadual, Municipal e Territorial)",
        "Seção não concluída no orçamento de tempo desta execução.",
      ].join("\n"),
    sectionMap.get("ops_5_8") ||
      [
        "## 5) Contratações Públicas (gov.br)",
        "Seção não concluída no orçamento de tempo desta execução.",
        "",
        "## 6) Plano de Ação Prioritário (30-60-90 dias)",
        "Seção não concluída no orçamento de tempo desta execução.",
        "",
        "## 7) Checklist de Evidências para Auditoria",
        "Seção não concluída no orçamento de tempo desta execução.",
        "",
        "## 8) Disclaimer Técnico",
        "Seção não concluída no orçamento de tempo desta execução.",
      ].join("\n"),
  ]
    .join("\n\n")
    .trim();

  const failedSections = sectionResults.filter((section) => !section.ok);
  const partial = failedSections.length > 0;

  return {
    analysis: {
      available: true,
      narrative,
      model: OPENAI_MODEL,
      partial,
      ...(partial
        ? {
            reason: "partial_generation",
            partial_failures: failedSections.map((section) => ({
              section: section.id,
              status_reason: section.status_reason,
              message: section.message,
            })),
          }
        : {}),
      ...(totalInputTokens > 0 ? { input_tokens: totalInputTokens } : {}),
      ...(totalOutputTokens > 0 ? { output_tokens: totalOutputTokens } : {}),
      generated_at: new Date().toISOString(),
    },
    source: normalizeSourcePayload(sourceId, "success", {
      latencyMs: Date.now() - start,
      statusReason: partial ? "partial_success" : "ok",
      message: partial
        ? `Relatório IA gerado parcialmente (${successfulSections.length}/${sectionPlans.length} etapa(s)).`
        : "Relatório IA completo gerado com sucesso.",
      evidenceCount: successfulSections.length,
    }),
  };
}

function buildDisclaimers() {
  return [
    "Correspondência CNAE x obrigação ambiental é indicativa, não vinculante.",
    "Enquadramento definitivo requer análise técnica especializada e consulta das FTEs oficiais.",
    "Cobertura nacional opera por maturidade de fontes: conectores automáticos coexistem com trilhas manuais auditáveis.",
    "Análise profunda CNAE x FTE depende do acervo RAG carregado no OpenAI Vector Store.",
    "Áreas contaminadas usam evidências estruturadas quando há API oficial; nos demais cenários, fluxo manual assistido.",
    "Relatório de IA tem caráter de apoio e não substitui parecer técnico-jurídico especializado.",
  ];
}

function riskWeight(value) {
  const normalized = String(value ?? "").toLowerCase();
  if (normalized === "alto") return 3;
  if (normalized === "medio") return 2;
  return 1;
}

function dedupeByKey(items, keyBuilder) {
  const seen = new Set();
  const output = [];
  for (const item of Array.isArray(items) ? items : []) {
    const key = String(keyBuilder(item));
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(item);
  }
  return output;
}

function buildExecutiveTopRisks({ fteDeepAnalysis, ibama, state, municipal, areasContaminadas }) {
  const fteRisks = Array.isArray(fteDeepAnalysis?.findings)
    ? fteDeepAnalysis.findings.map((item) => ({
        sphere: "federal",
        severity: item?.risco ?? "baixo",
        title: `CNAE ${item?.cnae_codigo ?? "-"} x FTE`,
        detail: item?.tese_enquadramento || "Possível enquadramento com necessidade de validação técnica.",
      }))
    : [];
  const ibamaRisks = Array.isArray(ibama?.matches)
    ? ibama.matches.map((item) => ({
        sphere: "federal",
        severity: item?.risco ?? "baixo",
        title: `IBAMA Cat. ${item?.categoria ?? "-"}`,
        detail: item?.obrigacao || item?.nome || "Enquadramento federal identificado.",
      }))
    : [];
  const stateRisks = Array.isArray(state?.details?.matches)
    ? state.details.matches.map((item) => ({
        sphere: "estadual",
        severity: item?.risco ?? "medio",
        title: `Licenciamento estadual CNAE ${item?.cnae ?? "-"}`,
        detail: item?.obrigacao || item?.descricao || "Obrigação estadual potencial.",
      }))
    : [];
  const municipalRisks = Array.isArray(municipal?.details?.matches)
    ? municipal.details.matches.map((item) => ({
        sphere: "municipal",
        severity: item?.risco ?? "medio",
        title: `Competencia municipal CNAE ${item?.cnae ?? "-"}`,
        detail: item?.enquadramento || item?.descricao || "Obrigação municipal potencial.",
      }))
    : [];
  const areasRisks = Array.isArray(areasContaminadas?.matches)
    ? areasContaminadas.matches.map((item) => ({
        sphere: "ambiental_territorial",
        severity: item?.risco ?? "medio",
        title: `Área contaminada (${item?.layer_name ?? "camada"})`,
        detail: `Match ${item?.match_id ?? "-"} com score ${Number(item?.score ?? 0).toFixed(2)}.`,
      }))
    : [];

  return dedupeByKey(
    [...fteRisks, ...ibamaRisks, ...stateRisks, ...municipalRisks, ...areasRisks]
      .sort((a, b) => riskWeight(b.severity) - riskWeight(a.severity))
      .slice(0, 3),
    (item) => `${item.title}|${item.detail}`
  );
}

function buildExecutiveCoverageGaps({ coverage, fteDeepAnalysis, areasContaminadas }) {
  const gaps = [];
  if (coverage?.federal?.status !== "api_ready") gaps.push("Cobertura federal parcial/manual.");
  if (coverage?.state?.status !== "api_ready") gaps.push("Cobertura estadual em modo manual_required para a UF.");
  if (coverage?.municipal?.status !== "api_ready") gaps.push("Cobertura municipal em modo manual_required para o município.");
  if (coverage?.ambiental_territorial?.status !== "api_ready") gaps.push("Cobertura territorial parcial/manual.");
  if (!fteDeepAnalysis?.available) gaps.push(`RAG/FTE em fallback: ${fteDeepAnalysis?.reason || "indisponível"}.`);
  if (areasContaminadas?.method !== "api_match") gaps.push("Áreas contaminadas exigem diligência manual assistida.");
  return normalizeStringArray(gaps).slice(0, 6);
}

function buildCriticalObligations({ federal, state, municipal, ibama }) {
  const obligations = normalizeStringArray([
    ...(Array.isArray(federal?.obligations) ? federal.obligations : []),
    ...(Array.isArray(state?.obligations) ? state.obligations : []),
    ...(Array.isArray(municipal?.obligations) ? municipal.obligations : []),
    ...(Array.isArray(ibama?.matches) ? ibama.matches.map((item) => item?.obrigacao) : []),
  ]);
  return obligations.slice(0, 3);
}

function buildFallbackFlags({ fteDeepAnalysis, state, municipal, areasContaminadas, aiReport }) {
  const flags = [];
  if (!fteDeepAnalysis?.available) flags.push(`rag_fallback:${fteDeepAnalysis?.reason || "indisponível"}`);
  if (state?.mode !== "api_ready") flags.push(`state_manual:${state?.uf || "N/A"}`);
  if (municipal?.mode !== "api_ready") flags.push(`municipal_manual:${municipal?.municipio_nome || "N/A"}`);
  if (areasContaminadas?.method !== "api_match") flags.push(`territorial_manual:${areasContaminadas?.status || "manual_required"}`);
  if (!aiReport?.available) flags.push(`ai_report_partial:${aiReport?.reason || "indisponível"}`);
  return flags;
}

function buildEvidenceIndex(evidence) {
  const byAgent = {};
  const bySource = {};
  for (const item of Array.isArray(evidence) ? evidence : []) {
    const agent = String(item?.agent ?? "unknown");
    const source = String(item?.source_id ?? "unknown");
    byAgent[agent] = Number(byAgent[agent] ?? 0) + 1;
    bySource[source] = Number(bySource[source] ?? 0) + 1;
  }
  return {
    total: Array.isArray(evidence) ? evidence.length : 0,
    by_agent: byAgent,
    by_source: bySource,
  };
}

/**
 * Política de confiança: sucesso da fonte → alta; erro, parcial ou manual_required → baixa.
 */
function buildConfidenceMap(evidence) {
  const map = { alta: 0, media: 0, baixa: 0 };
  for (const item of Array.isArray(evidence) ? evidence : []) {
    const level = String(item?.confianca ?? "").toLowerCase();
    if (level === "alta" || level === "media" || level === "baixa") {
      map[level] += 1;
    }
  }
  return map;
}

function buildActionPlan({ summary, federal, state, municipal, fteDeepAnalysis, areasContaminadas, coverage, aiReport }) {
  const items = [];
  const pushItem = (payload) => {
    if (!payload?.title) return;
    if (items.find((entry) => entry.title === payload.title)) return;
    items.push({
      id: `ap_${items.length + 1}`,
      title: String(payload.title).slice(0, 360),
      priority: payload.priority === "alta" || payload.priority === "baixa" ? payload.priority : "media",
      owner: null,
      due_date: null,
      status: "pendente",
      source_refs: normalizeStringArray(payload.source_refs || []),
    });
  };

  const topObligation = Array.isArray(federal?.obligations) && federal.obligations.length > 0 ? federal.obligations[0] : null;
  if (topObligation) {
    pushItem({
      title: `Validar e cumprir obrigação federal crítica: ${topObligation}`,
      priority: summary?.risk_level === "alto" ? "alta" : "media",
      source_refs: ["federal.ibama.ctf_app.base"],
    });
  }

  if (state?.mode === "api_ready" && Array.isArray(state?.details?.matches) && state.details.matches.length > 0) {
    pushItem({
      title: "Abrir frente de licenciamento estadual (LP/LI/LO) para atividades mapeadas.",
      priority: "alta",
      source_refs: ["state.sp.cetesb.anexo5"],
    });
  }

  if (municipal?.mode === "api_ready" && Array.isArray(municipal?.details?.matches) && municipal.details.matches.length > 0) {
    pushItem({
      title: "Confirmar competencia municipal habilitada e rito local de licenciamento.",
      priority: "media",
      source_refs: ["municipal.sp.consema_012024"],
    });
  }

  if (areasContaminadas?.method === "api_match" && Array.isArray(areasContaminadas?.matches) && areasContaminadas.matches.length > 0) {
    pushItem({
      title: "Executar diligência territorial imediata para os matches de áreas contaminadas.",
      priority: "alta",
      source_refs: [...(areasContaminadas.evidence_refs || []), "territorial.sp.areas_contaminadas"],
    });
  } else if (areasContaminadas?.method !== "api_match") {
    pushItem({
      title: "Completar diligência manual de áreas contaminadas no mapa oficial e anexar evidências.",
      priority: "media",
      source_refs: ["territorial.default.manual"],
    });
  }

  if (!fteDeepAnalysis?.available) {
    pushItem({
      title: "Reprocessar agente RAG/FTE e revisar enquadramento por tabela FTE oficial.",
      priority: "media",
      source_refs: ["openai_fte_rag"],
    });
  }

  if (!aiReport?.available) {
    pushItem({
      title: "Regerar relatório IA auditável após estabilizar conectores/fallbacks.",
      priority: "baixa",
      source_refs: ["openai_relatorio_ambiental"],
    });
  }

  if (coverage?.state?.status !== "api_ready" || coverage?.municipal?.status !== "api_ready") {
    pushItem({
      title: "Executar checklist de diligência manual para lacunas estaduais/municipais.",
      priority: "media",
      source_refs: ["state.default.manual", "municipal.default.manual"],
    });
  }

  if (items.length === 0) {
    pushItem({
      title: "Manter monitoramento de conformidade ambiental e revisar periodicamente o enquadramento.",
      priority: "baixa",
      source_refs: [],
    });
  }

  return {
    items: items.slice(0, 12),
  };
}

function buildUxV2({ summary, federal, state, municipal, coverage, fteDeepAnalysis, ibama, areasContaminadas, aiReport, evidence }) {
  const criticalObligations = buildCriticalObligations({ federal, state, municipal, ibama });
  const coverageGaps = buildExecutiveCoverageGaps({ coverage, fteDeepAnalysis, areasContaminadas });
  const topRisks = buildExecutiveTopRisks({ fteDeepAnalysis, ibama, state, municipal, areasContaminadas });
  const fallbackFlags = buildFallbackFlags({ fteDeepAnalysis, state, municipal, areasContaminadas, aiReport });

  return {
    executive: {
      decision_summary: `Risco agregado ${String(summary?.risk_level ?? "medio").toUpperCase()} com ${Number(summary?.total_alerts ?? 0)} alerta(s) no recorte atual.`,
      critical_obligations: criticalObligations,
      coverage_gaps: coverageGaps,
      top_risks: topRisks,
    },
    audit: {
      confidence_map: buildConfidenceMap(evidence),
      evidence_index: buildEvidenceIndex(evidence),
      fallback_flags: fallbackFlags,
    },
  };
}

/**
 * @param {string} cnpj
 */
export async function analyzeEnvironmentalCompliance(cnpj) {
  const cleanCnpj = normalizeCnpj(cnpj);
  if (cleanCnpj.length !== 14) {
    throw new EnvironmentalHttpError(400, "CNPJ inválido. Deve conter 14 dígitos.");
  }

  const orchestration = createOrchestration(cleanCnpj);

  let company = null;
  let sources = [];
  let evidence = [];
  let jurisdictionContext = null;
  let coverage = null;
  let sourceCatalog = null;
  let ruleCatalog = null;
  let fteDeepAnalysis = null;
  let ibama = null;
  let federal = null;
  let state = null;
  let municipal = null;
  let areasContaminadas = null;
  let govbrContext = null;
  let aiReport = null;
  let companySource = null;

  updateOrchestrationStep(orchestration, "agent_1_cnpj_cnae", "running", {
    message: "Consultando CNPJ e extraindo CNAEs.",
  });
  try {
    const companyLookup = await fetchCompanyByCnpj(cleanCnpj);
    company = companyLookup.company;
    sources = companyLookup.sources;
    companySource = sources.find((entry) => entry?.status === "success") ?? sources[sources.length - 1] ?? null;
    const govbrResult = await queryGovBrContractsContext(cleanCnpj);
    govbrContext = govbrResult.context;
    sources = upsertSourcePayload(sources, govbrResult.source);
    jurisdictionContext = buildJurisdictionContext(company);
    coverage = buildCoverageMatrix({
      uf: jurisdictionContext?.uf,
      municipioIbge: jurisdictionContext?.municipio_ibge,
      municipioNome: jurisdictionContext?.municipio_nome,
    });
    sourceCatalog = getEnvironmentalSourceCatalog({ uf: jurisdictionContext?.uf });
    ruleCatalog = getEnvironmentalRuleCatalog({ uf: jurisdictionContext?.uf });

    if (companySource) {
      evidence.push(
        buildEvidenceRecord({
          agent: "agent_1_cnpj_cnae",
          source: companySource,
          jurisdiction: "federal",
          status: "success",
          confidence: "alta",
          summary: "Consulta cadastral e CNAEs da empresa obtidos em fonte oficial.",
          input: { cnpj: cleanCnpj },
          output: company,
        })
      );
    }
    if (govbrResult?.source) {
      evidence.push(
        buildEvidenceRecord({
          agent: "agent_1_cnpj_cnae",
          source: govbrResult.source,
          jurisdiction: "federal",
          status: govbrResult.source.status === "success" ? "success" : "partial",
          confidence: govbrResult.source.status === "success" ? "alta" : "baixa",
          summary:
            govbrResult.source.status === "success"
              ? `Contexto gov.br coletado com ${Number(govbrResult.context?.found_records ?? 0)} registro(s).`
              : `Contexto gov.br indisponível/parcial (${govbrResult.source.status_reason || "sem motivo"}).`,
          input: { cnpj: cleanCnpj },
          output: govbrResult.context,
        })
      );
    }

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
    message: "Executando análise aprofundada CNAE x FTE com RAG.",
  });
  const fteResult = await generateFteDeepCnaeAnalysis({ company });
  fteDeepAnalysis = fteResult.analysis;
  sources = upsertSourcePayload(sources, fteResult.source);
  evidence.push(
    buildEvidenceRecord({
      agent: "agent_2_fte_rag_cnae",
      source: fteResult.source,
      jurisdiction: "federal",
      status: fteResult.source.status === "success" ? "success" : "partial",
      confidence: fteResult.source.status === "success" ? "alta" : "baixa",
      summary: fteDeepAnalysis?.available
        ? `Análise RAG concluída para ${Number(fteDeepAnalysis?.stats?.total_findings ?? 0)} CNAE(s).`
        : `Análise RAG indisponível (${fteDeepAnalysis?.reason ?? "motivo não informado"}).`,
      input: {
        cnpj: cleanCnpj,
        cnaes: company.cnaes,
      },
      output: fteDeepAnalysis,
    })
  );
  updateOrchestrationStep(orchestration, "agent_2_fte_rag_cnae", "completed", {
    message: fteDeepAnalysis?.available
      ? `Análise profunda concluída para ${fteDeepAnalysis?.stats?.total_findings ?? company.cnaes.length} CNAE(s).`
      : `Análise profunda indisponível: ${fteDeepAnalysis?.reason ?? "motivo não informado"}`,
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
  const federalSource = normalizeSourcePayload(
    "ibama_rule_engine",
    ibama.enquadrado ? "success" : "not_found",
    {
      latencyMs: 0,
      statusReason: ibama.enquadrado ? "rule_match" : "no_match",
      evidenceCount: ibama.matches.length,
    },
    "Motor de Regras Federais (IBAMA/CTF/FTE)"
  );
  sources = upsertSourcePayload(sources, federalSource);
  evidence.push(
    buildEvidenceRecord({
      agent: "agent_3_ibama_fte",
      source: federalSource,
      jurisdiction: "federal",
      ruleId: "federal.ibama.ctf_app.base",
      status: ibama.enquadrado ? "success" : "not_found",
      confidence: "alta",
      summary: ibama.enquadrado
        ? `${ibama.matches.length} enquadramento(s) federal(is) identificado(s).`
        : "Nenhum enquadramento federal direto identificado por regra CNAE/FTE.",
      input: { cnaes: company.cnaes },
      output: ibama,
    })
  );
  federal = {
    scope: "federal",
    ibama,
    fte_rag: {
      available: Boolean(fteDeepAnalysis?.available),
      stats: fteDeepAnalysis?.stats ?? null,
      overall_recommendations: Array.isArray(fteDeepAnalysis?.overall_recommendations) ? fteDeepAnalysis.overall_recommendations : [],
    },
    govbr_context: govbrContext,
    obligations: normalizeStringArray([
      ...ibama.matches.map((item) => item?.obrigacao).filter(Boolean),
      ...(Array.isArray(fteDeepAnalysis?.findings)
        ? fteDeepAnalysis.findings.flatMap((item) => (Array.isArray(item?.obrigacoes) ? item.obrigacoes : []))
        : []),
    ]),
  };
  updateOrchestrationStep(orchestration, "agent_3_ibama_fte", "completed", {
    message: `${ibama.matches.length} possível(is) enquadramento(s) no IBAMA.`,
    summary: {
      enquadrado: ibama.enquadrado,
      matches: ibama.matches.length,
    },
  });

  updateOrchestrationStep(orchestration, "agent_4_state", "running", {
    message: "Aplicando regras estaduais dinâmicas conforme UF.",
  });
  state = agentStateNational(company.cnaes, jurisdictionContext?.uf);
  const stateMatches = extractStateMatches(state);
  const stateSource = normalizeSourcePayload(
    state?.source_id ?? "estadual_licenciamento_default",
    state?.mode === "api_ready" ? (stateMatches.length > 0 ? "success" : "not_found") : "unavailable",
    {
      latencyMs: 0,
      statusReason: state?.mode === "api_ready" ? (stateMatches.length > 0 ? "rule_match" : "no_match") : "manual_required",
      evidenceCount: stateMatches.length,
      ...(state?.mode === "api_ready"
        ? {}
        : {
            message: "Conector estadual automático indisponível para a UF nesta versão.",
          }),
    }
  );
  sources = upsertSourcePayload(sources, stateSource);
  evidence.push(
    buildEvidenceRecord({
      agent: "agent_4_state",
      source: stateSource,
      jurisdiction: `estadual:${jurisdictionContext?.uf ?? "N/A"}`,
      ruleId: state?.mode === "api_ready" ? "state.sp.cetesb.anexo5" : "state.default.manual",
      status: state?.mode === "api_ready" ? "success" : "manual_required",
      confidence: state?.mode === "api_ready" ? "alta" : "baixa",
      summary: state?.nota ?? "Análise estadual concluída.",
      input: { cnaes: company.cnaes, uf: jurisdictionContext?.uf ?? null },
      output: state,
    })
  );
  updateOrchestrationStep(orchestration, "agent_4_state", "completed", {
    message:
      state?.mode === "api_ready"
        ? `${stateMatches.length} achado(s) estadual(is) identificado(s) para ${state?.uf ?? "UF"}`
        : `UF ${state?.uf ?? "N/A"} em fluxo estadual assistido (manual_required).`,
    summary: {
      mode: state?.mode ?? "manual_required",
      matches: stateMatches.length,
      available: Boolean(state?.available),
    },
  });

  updateOrchestrationStep(orchestration, "agent_5_municipal", "running", {
    message: "Aplicando regras municipais dinâmicas por município.",
  });
  municipal = agentMunicipalNational(company.cnaes, jurisdictionContext?.uf, jurisdictionContext?.municipio_nome);
  const municipalMatches = extractMunicipalMatches(municipal);
  const municipalSource = normalizeSourcePayload(
    municipal?.source_id ?? "municipal_licenciamento_generico",
    municipal?.mode === "api_ready" ? (municipalMatches.length > 0 ? "success" : "not_found") : "unavailable",
    {
      latencyMs: 0,
      statusReason: municipal?.mode === "api_ready" ? (municipalMatches.length > 0 ? "rule_match" : "no_match") : "manual_required",
      evidenceCount: municipalMatches.length,
      ...(municipal?.mode === "api_ready"
        ? {}
        : {
            message: "Conector municipal automático indisponível para o município nesta versão.",
          }),
    }
  );
  sources = upsertSourcePayload(sources, municipalSource);
  evidence.push(
    buildEvidenceRecord({
      agent: "agent_5_municipal",
      source: municipalSource,
      jurisdiction: `municipal:${jurisdictionContext?.municipio_nome ?? "N/A"}`,
      ruleId: municipal?.mode === "api_ready" ? "municipal.sp.consema_012024" : "municipal.default.manual",
      status: municipal?.mode === "api_ready" ? "success" : "manual_required",
      confidence: municipal?.mode === "api_ready" ? "alta" : "baixa",
      summary: municipal?.nota ?? "Análise municipal concluída.",
      input: {
        cnaes: company.cnaes,
        uf: jurisdictionContext?.uf ?? null,
        municipio_nome: jurisdictionContext?.municipio_nome ?? null,
      },
      output: municipal,
    })
  );
  updateOrchestrationStep(orchestration, "agent_5_municipal", "completed", {
    message:
      municipal?.mode === "api_ready"
        ? `${municipalMatches.length} achado(s) municipal(is) identificado(s).`
        : "Fluxo municipal em modo assistido (manual_required).",
    summary: {
      mode: municipal?.mode ?? "manual_required",
      matches: municipalMatches.length,
      available: Boolean(municipal?.available),
    },
  });

  updateOrchestrationStep(orchestration, "agent_6_areas_contaminadas", "running", {
    message: "Executando motor de áreas contaminadas (api_match/manual).",
  });
  const areasResult = await agentAreasContaminadasNational(company, jurisdictionContext?.uf);
  areasContaminadas = areasResult.result;
  sources = upsertSourcePayload(sources, areasResult.source);
  evidence.push(
    buildEvidenceRecord({
      agent: "agent_6_areas_contaminadas",
      source: areasResult.source,
      jurisdiction: `ambiental_territorial:${jurisdictionContext?.uf ?? "N/A"}`,
      ruleId:
        jurisdictionContext?.uf === "SP" && areasContaminadas?.method === "api_match"
          ? "territorial.sp.areas_contaminadas"
          : "territorial.default.manual",
      status: areasResult.source?.status === "success" ? "success" : "manual_required",
      confidence: areasResult.source?.status === "success" ? "alta" : "baixa",
      summary: areasContaminadas?.summary ?? "Análise territorial concluída.",
      input: {
        cnpj: cleanCnpj,
        endereco: company?.endereco ?? null,
        uf: jurisdictionContext?.uf ?? null,
      },
      output: areasContaminadas,
    })
  );
  updateOrchestrationStep(orchestration, "agent_6_areas_contaminadas", "completed", {
    message: `${areasContaminadas?.matches?.length ?? 0} match(es) territorial(is) retornado(s).`,
    summary: {
      method: areasContaminadas?.method ?? "manual_required",
      matches: Number(areasContaminadas?.matches?.length ?? 0),
      status: areasContaminadas?.status ?? "manual_required",
    },
  });

  const fteAlerts = countRisk(fteDeepAnalysis?.findings, "alto") + countRisk(fteDeepAnalysis?.findings, "medio");
  const stateAlerts = stateMatches.length;
  const municipalAlerts = municipalMatches.length;
  const areaAlerts = Number(areasContaminadas?.matches?.length ?? 0);
  const federalAlerts = Number(ibama.matches?.length ?? 0) + Number(fteAlerts ?? 0);
  const totalAlerts =
    federalAlerts + Number(stateAlerts ?? 0) + Number(municipalAlerts ?? 0) + Number(areaAlerts ?? 0);
  const riskLevel = classifyComplianceRisk({ fteDeepAnalysis, ibama, state, municipal, areasContaminadas });
  const summary = {
    total_alerts: totalAlerts,
    fte_alerts: Number(fteAlerts ?? 0),
    ibama_alerts: Number(ibama.matches?.length ?? 0),
    state_alerts: Number(stateAlerts ?? 0),
    municipal_alerts: Number(municipalAlerts ?? 0),
    areas_alerts: Number(areaAlerts ?? 0),
    cetesb_alerts: Number(stateAlerts ?? 0),
    by_sphere: {
      federal: federalAlerts,
      estadual: Number(stateAlerts ?? 0),
      municipal: Number(municipalAlerts ?? 0),
      ambiental_territorial: Number(areaAlerts ?? 0),
    },
    coverage_status: {
      federal: coverage?.federal?.status ?? null,
      state: coverage?.state?.status ?? null,
      municipal: coverage?.municipal?.status ?? null,
      ambiental_territorial: coverage?.ambiental_territorial?.status ?? null,
    },
    risk_level: riskLevel,
  };

  updateOrchestrationStep(orchestration, "agent_7_relatorio_ai", "running", {
    message: "Gerando relatório de IA auditável a partir das evidências coletadas.",
  });
  const aiResult = await generateEnvironmentalAiReport({
    company,
    jurisdictionContext,
    fteDeepAnalysis,
    federal,
    state,
    municipal,
    areasContaminadas,
    govbrContext,
    coverage,
    evidence,
    summary,
    sources,
  });
  aiReport = aiResult.analysis;
  sources = upsertSourcePayload(sources, aiResult.source);
  evidence.push(
    buildEvidenceRecord({
      agent: "agent_7_relatorio_ai",
      source: aiResult.source,
      jurisdiction: "federal",
      status: aiResult.source.status === "success" ? "success" : "partial",
      confidence: aiResult.source.status === "success" ? "alta" : "baixa",
      summary: aiReport?.available
        ? "Relatório IA consolidado com base em evidências estruturadas."
        : `Relatório IA indisponível (${aiReport?.reason ?? "motivo não informado"}).`,
      input: {
        cnpj: cleanCnpj,
        summary,
        evidence_count: evidence.length,
      },
      output: aiReport,
    })
  );
  updateOrchestrationStep(orchestration, "agent_7_relatorio_ai", "completed", {
    message: aiReport?.available
      ? "Relatório IA gerado com sucesso."
      : `Relatório IA indisponível: ${aiReport?.reason ?? "motivo não informado"}`,
    summary: {
      available: Boolean(aiReport?.available),
      model: aiReport?.model ?? null,
      source_status: aiResult?.source?.status ?? "unknown",
    },
  });

  orchestration.status = "completed";
  orchestration.completed_at = new Date().toISOString();

  const cetesbCompat =
    state?.details && typeof state.details === "object"
      ? state.details
      : {
          enquadrado: false,
          matches: [],
          lp_precedente: false,
          rmsp_restricoes: false,
          nota_rmsp: null,
          links: {
            atividades: "",
            tabela_atividades: "",
            portal_licenciamento: "",
          },
        };
  const municipalCompat =
    municipal?.details && typeof municipal.details === "object"
      ? municipal.details
      : {
          enquadrado: false,
          matches: [],
          legislacao: {
            lc140: "",
            consema: "",
            municipios_habilitados: "",
          },
          nota: "",
        };
  const uxV2 = buildUxV2({
    summary,
    federal,
    state,
    municipal,
    coverage,
    fteDeepAnalysis,
    ibama,
    areasContaminadas,
    aiReport,
    evidence,
  });
  const actionPlan = buildActionPlan({
    summary,
    federal,
    state,
    municipal,
    fteDeepAnalysis,
    areasContaminadas,
    coverage,
    aiReport,
  });

  return {
    schema_version: "br-v1",
    cnpj: cleanCnpj,
    jurisdiction_context: jurisdictionContext,
    company,
    federal,
    state,
    municipal,
    areas_contaminadas: areasContaminadas,
    coverage,
    evidence,
    source_catalog: sourceCatalog,
    rule_catalog: ruleCatalog,
    fte_deep_analysis: fteDeepAnalysis,
    ibama,
    cetesb: cetesbCompat,
    municipal_legacy: municipalCompat,
    govbr_context: govbrContext,
    ai_report: aiReport,
    ux_v2: uxV2,
    action_plan: actionPlan,
    summary,
    orchestration,
    disclaimers: buildDisclaimers(),
    sources,
    analyzed_at: new Date().toISOString(),
  };
}
