const UFS = [
  "AC",
  "AL",
  "AP",
  "AM",
  "BA",
  "CE",
  "DF",
  "ES",
  "GO",
  "MA",
  "MT",
  "MS",
  "MG",
  "PA",
  "PB",
  "PR",
  "PE",
  "PI",
  "RJ",
  "RN",
  "RS",
  "RO",
  "RR",
  "SC",
  "SP",
  "SE",
  "TO",
];

export const ENV_SOURCE_CATALOG_VERSION = (process.env.ENV_SOURCE_CATALOG_VERSION ?? "2026.03.05.1").trim();

const FEDERAL_SOURCE_CATALOG = [
  {
    source_id: "receita_brasilapi",
    jurisdicao: "federal",
    tipo_acesso: "api",
    sla: "best_effort",
    auth: "none",
    rate_limit: "public",
    capacidade_consulta: ["cnpj_lookup", "cnae"],
  },
  {
    source_id: "receita_opencnpj",
    jurisdicao: "federal",
    tipo_acesso: "api",
    sla: "best_effort",
    auth: "api_key_optional",
    rate_limit: "50 req/s por IP (informado pelo provedor)",
    capacidade_consulta: ["cnpj_lookup", "cnae"],
  },
  {
    source_id: "receita_receitaws",
    jurisdicao: "federal",
    tipo_acesso: "api",
    sla: "best_effort",
    auth: "token_optional",
    rate_limit: "3 req/min (plano free, informado pelo provedor)",
    capacidade_consulta: ["cnpj_lookup", "cnae"],
  },
  {
    source_id: "openai_fte_rag",
    jurisdicao: "federal",
    tipo_acesso: "api",
    sla: "best_effort",
    auth: "api_key",
    rate_limit: "conforme conta OpenAI",
    capacidade_consulta: ["rag_fte", "analise_cnae_fte"],
  },
  {
    source_id: "cgu_licitacoes_contratos",
    jurisdicao: "federal",
    tipo_acesso: "api",
    sla: "best_effort",
    auth: "api_key",
    rate_limit: "conforme portal",
    capacidade_consulta: ["contexto_contratual"],
  },
  {
    source_id: "openai_relatorio_ambiental",
    jurisdicao: "federal",
    tipo_acesso: "api",
    sla: "best_effort",
    auth: "api_key",
    rate_limit: "conforme conta OpenAI",
    capacidade_consulta: ["sintese_relatorio"],
  },
];

function normalizeUf(uf) {
  return String(uf ?? "").trim().toUpperCase();
}

export function listFederalSourceCatalog() {
  return [...FEDERAL_SOURCE_CATALOG];
}

export function listStateSourceCatalog() {
  return UFS.map((uf) => ({
    source_id: uf === "SP" ? "sp_cetesb_licenciamento" : `estadual_licenciamento_${uf.toLowerCase()}`,
    jurisdicao: `estadual:${uf}`,
    tipo_acesso: uf === "SP" ? "api" : "portal",
    sla: "best_effort",
    auth: "none",
    rate_limit: uf === "SP" ? "public" : "n/a",
    capacidade_consulta: uf === "SP" ? ["licenciamento_estadual", "enquadramento_sp"] : ["consulta_manual_assistida"],
  }));
}

export function listMunicipalSourceCatalog() {
  return [
    {
      source_id: "municipal_licenciamento_generico",
      jurisdicao: "municipal:*",
      tipo_acesso: "portal",
      sla: "best_effort",
      auth: "none",
      rate_limit: "n/a",
      capacidade_consulta: ["consulta_manual_assistida", "checklist_municipal"],
    },
    {
      source_id: "sp_consema_municipal",
      jurisdicao: "municipal:SP",
      tipo_acesso: "dataset",
      sla: "best_effort",
      auth: "none",
      rate_limit: "public",
      capacidade_consulta: ["tipologia_consema_2024", "competencia_municipal_sp"],
    },
  ];
}

export function listAreaSourceCatalog() {
  return [
    {
      source_id: "sp_semil_areas_contaminadas_api",
      jurisdicao: "ambiental_territorial:SP",
      tipo_acesso: "api",
      sla: "best_effort",
      auth: "none",
      rate_limit: "public",
      capacidade_consulta: ["match_cep", "match_razao_social", "match_endereco", "mapa_embed_oficial"],
    },
    {
      source_id: "areas_contaminadas_manual_nacional",
      jurisdicao: "ambiental_territorial:*",
      tipo_acesso: "portal",
      sla: "best_effort",
      auth: "none",
      rate_limit: "n/a",
      capacidade_consulta: ["consulta_manual_assistida"],
    },
  ];
}

export function getEnvironmentalSourceCatalog({ uf } = {}) {
  const normalizedUf = normalizeUf(uf);
  const federal = listFederalSourceCatalog();
  const states = listStateSourceCatalog();
  const municipals = listMunicipalSourceCatalog();
  const areas = listAreaSourceCatalog();

  return {
    version: ENV_SOURCE_CATALOG_VERSION,
    federal,
    state: states.filter((entry) => normalizedUf ? entry.jurisdicao === `estadual:${normalizedUf}` : true),
    municipal: municipals.filter((entry) => {
      if (!normalizedUf) return true;
      if (entry.jurisdicao === "municipal:*") return true;
      return entry.jurisdicao === `municipal:${normalizedUf}`;
    }),
    ambiental_territorial: areas.filter((entry) => {
      if (!normalizedUf) return true;
      if (entry.jurisdicao === "ambiental_territorial:*") return true;
      return entry.jurisdicao === `ambiental_territorial:${normalizedUf}`;
    }),
  };
}

export function buildCoverageMatrix({ uf, municipioIbge, municipioNome }) {
  const normalizedUf = normalizeUf(uf);
  const stateMode = normalizedUf === "SP" ? "api_ready" : "manual_required";
  const municipalMode = normalizedUf === "SP" ? "api_ready" : "manual_required";
  const areasMode = normalizedUf === "SP" ? "api_ready" : "manual_required";

  return {
    scope_mode: "national",
    jurisdiction: {
      uf: normalizedUf || null,
      municipio_ibge: String(municipioIbge ?? "").trim() || null,
      municipio_nome: String(municipioNome ?? "").trim() || null,
    },
    federal: {
      status: "api_ready",
      mode: "api",
      sources: listFederalSourceCatalog().map((source) => source.source_id),
    },
    state: {
      status: stateMode,
      mode: stateMode === "api_ready" ? "api" : "manual",
      sources: listStateSourceCatalog()
        .filter((source) => source.jurisdicao === `estadual:${normalizedUf}`)
        .map((source) => source.source_id),
    },
    municipal: {
      status: municipalMode,
      mode: municipalMode === "api_ready" ? "dataset" : "manual",
      sources:
        municipalMode === "api_ready"
          ? ["sp_consema_municipal", "municipal_licenciamento_generico"]
          : ["municipal_licenciamento_generico"],
    },
    ambiental_territorial: {
      status: areasMode,
      mode: areasMode === "api_ready" ? "api" : "manual",
      sources: areasMode === "api_ready" ? ["sp_semil_areas_contaminadas_api"] : ["areas_contaminadas_manual_nacional"],
    },
  };
}
