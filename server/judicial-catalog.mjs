import { PUBLIC_SEARCH_URL_BY_TRIBUNAL } from "./judicial-public-search-urls.mjs";

const TRIBUNAL_QUERY_MODES_FULL = ["cnpj_exact", "party_name", "process_number"];
const TRIBUNAL_QUERY_MODES_NAME_OR_PROCESS = ["party_name", "process_number"];

function makeTribunal({
  tribunalId,
  nome,
  ramo,
  ufScope,
  connectorFamily,
  queryModes = TRIBUNAL_QUERY_MODES_FULL,
  active = true,
  priority = 50,
  config = {},
}) {
  const mergedConfig = {
    ...(config ?? {}),
  };
  const mappedUrl = PUBLIC_SEARCH_URL_BY_TRIBUNAL[String(tribunalId ?? "").toLowerCase()];
  if (mappedUrl && !mergedConfig.base_url && ramo !== "eleitoral") {
    mergedConfig.base_url = mappedUrl;
  }

  return {
    tribunal_id: tribunalId,
    nome,
    ramo,
    uf_scope: ufScope,
    connector_family: connectorFamily,
    query_modes_supported_json: queryModes,
    active,
    priority,
    config_json: mergedConfig,
  };
}

const SUPERIORES = [
  makeTribunal({ tribunalId: "stf", nome: "Supremo Tribunal Federal", ramo: "superior", ufScope: "*", connectorFamily: "custom", priority: 100, config: { fallbackFamilies: ["datajud"] } }),
  makeTribunal({ tribunalId: "stj", nome: "Superior Tribunal de Justiça", ramo: "superior", ufScope: "*", connectorFamily: "custom", priority: 100, config: { fallbackFamilies: ["datajud"] } }),
  makeTribunal({ tribunalId: "tst", nome: "Tribunal Superior do Trabalho", ramo: "superior", ufScope: "*", connectorFamily: "custom", priority: 95, config: { fallbackFamilies: ["datajud"] } }),
  makeTribunal({ tribunalId: "tse", nome: "Tribunal Superior Eleitoral", ramo: "superior", ufScope: "*", connectorFamily: "datajud", priority: 90 }),
  makeTribunal({ tribunalId: "stm", nome: "Superior Tribunal Militar", ramo: "superior", ufScope: "*", connectorFamily: "custom", priority: 80, config: { fallbackFamilies: ["datajud"] } }),
];

const TRFS = [
  makeTribunal({ tribunalId: "trf1", nome: "TRF 1ª Região", ramo: "federal", ufScope: "AC,AM,AP,BA,DF,GO,MA,MT,PA,PI,RO,RR,TO", connectorFamily: "pje", priority: 95, config: { fallbackFamilies: ["datajud"] } }),
  makeTribunal({ tribunalId: "trf2", nome: "TRF 2ª Região", ramo: "federal", ufScope: "ES,RJ", connectorFamily: "pje", priority: 95, config: { fallbackFamilies: ["datajud"] } }),
  makeTribunal({ tribunalId: "trf3", nome: "TRF 3ª Região", ramo: "federal", ufScope: "MS,SP", connectorFamily: "pje", priority: 95, config: { fallbackFamilies: ["datajud"] } }),
  makeTribunal({ tribunalId: "trf4", nome: "TRF 4ª Região", ramo: "federal", ufScope: "PR,RS,SC", connectorFamily: "eproc", priority: 95, config: { fallbackFamilies: ["datajud"] } }),
  makeTribunal({ tribunalId: "trf5", nome: "TRF 5ª Região", ramo: "federal", ufScope: "AL,CE,PB,PE,RN,SE", connectorFamily: "pje", priority: 95, config: { fallbackFamilies: ["datajud"] } }),
  makeTribunal({ tribunalId: "trf6", nome: "TRF 6ª Região", ramo: "federal", ufScope: "MG", connectorFamily: "pje", priority: 95, config: { fallbackFamilies: ["datajud"] } }),
];

const TRTS = [
  makeTribunal({ tribunalId: "trt1", nome: "TRT 1ª Região", ramo: "trabalhista", ufScope: "RJ", connectorFamily: "pje", priority: 80, config: { fallbackFamilies: ["datajud"] } }),
  makeTribunal({ tribunalId: "trt2", nome: "TRT 2ª Região", ramo: "trabalhista", ufScope: "SP", connectorFamily: "pje", priority: 85, config: { fallbackFamilies: ["datajud"] } }),
  makeTribunal({ tribunalId: "trt3", nome: "TRT 3ª Região", ramo: "trabalhista", ufScope: "MG", connectorFamily: "pje", priority: 80, config: { fallbackFamilies: ["datajud"] } }),
  makeTribunal({ tribunalId: "trt4", nome: "TRT 4ª Região", ramo: "trabalhista", ufScope: "RS", connectorFamily: "pje", priority: 80, config: { fallbackFamilies: ["datajud"] } }),
  makeTribunal({ tribunalId: "trt5", nome: "TRT 5ª Região", ramo: "trabalhista", ufScope: "BA", connectorFamily: "pje", priority: 75, config: { fallbackFamilies: ["datajud"] } }),
  makeTribunal({ tribunalId: "trt6", nome: "TRT 6ª Região", ramo: "trabalhista", ufScope: "PE", connectorFamily: "pje", priority: 75, config: { fallbackFamilies: ["datajud"] } }),
  makeTribunal({ tribunalId: "trt7", nome: "TRT 7ª Região", ramo: "trabalhista", ufScope: "CE", connectorFamily: "pje", priority: 70, config: { fallbackFamilies: ["datajud"] } }),
  makeTribunal({ tribunalId: "trt8", nome: "TRT 8ª Região", ramo: "trabalhista", ufScope: "AP,PA", connectorFamily: "pje", priority: 70, config: { fallbackFamilies: ["datajud"] } }),
  makeTribunal({ tribunalId: "trt9", nome: "TRT 9ª Região", ramo: "trabalhista", ufScope: "PR", connectorFamily: "pje", priority: 70, config: { fallbackFamilies: ["datajud"] } }),
  makeTribunal({ tribunalId: "trt10", nome: "TRT 10ª Região", ramo: "trabalhista", ufScope: "DF,TO", connectorFamily: "pje", priority: 70, config: { fallbackFamilies: ["datajud"] } }),
  makeTribunal({ tribunalId: "trt11", nome: "TRT 11ª Região", ramo: "trabalhista", ufScope: "AM,RR", connectorFamily: "pje", priority: 70, config: { fallbackFamilies: ["datajud"] } }),
  makeTribunal({ tribunalId: "trt12", nome: "TRT 12ª Região", ramo: "trabalhista", ufScope: "SC", connectorFamily: "pje", priority: 70, config: { fallbackFamilies: ["datajud"] } }),
  makeTribunal({ tribunalId: "trt13", nome: "TRT 13ª Região", ramo: "trabalhista", ufScope: "PB", connectorFamily: "pje", priority: 70, config: { fallbackFamilies: ["datajud"] } }),
  makeTribunal({ tribunalId: "trt14", nome: "TRT 14ª Região", ramo: "trabalhista", ufScope: "AC,RO", connectorFamily: "pje", priority: 70, config: { fallbackFamilies: ["datajud"] } }),
  makeTribunal({ tribunalId: "trt15", nome: "TRT 15ª Região", ramo: "trabalhista", ufScope: "SP", connectorFamily: "pje", priority: 75, config: { fallbackFamilies: ["datajud"] } }),
  makeTribunal({ tribunalId: "trt16", nome: "TRT 16ª Região", ramo: "trabalhista", ufScope: "MA", connectorFamily: "pje", priority: 65, config: { fallbackFamilies: ["datajud"] } }),
  makeTribunal({ tribunalId: "trt17", nome: "TRT 17ª Região", ramo: "trabalhista", ufScope: "ES", connectorFamily: "pje", priority: 65, config: { fallbackFamilies: ["datajud"] } }),
  makeTribunal({ tribunalId: "trt18", nome: "TRT 18ª Região", ramo: "trabalhista", ufScope: "GO", connectorFamily: "pje", priority: 65, config: { fallbackFamilies: ["datajud"] } }),
  makeTribunal({ tribunalId: "trt19", nome: "TRT 19ª Região", ramo: "trabalhista", ufScope: "AL", connectorFamily: "pje", priority: 65, config: { fallbackFamilies: ["datajud"] } }),
  makeTribunal({ tribunalId: "trt20", nome: "TRT 20ª Região", ramo: "trabalhista", ufScope: "SE", connectorFamily: "pje", priority: 65, config: { fallbackFamilies: ["datajud"] } }),
  makeTribunal({ tribunalId: "trt21", nome: "TRT 21ª Região", ramo: "trabalhista", ufScope: "RN", connectorFamily: "pje", priority: 65, config: { fallbackFamilies: ["datajud"] } }),
  makeTribunal({ tribunalId: "trt22", nome: "TRT 22ª Região", ramo: "trabalhista", ufScope: "PI", connectorFamily: "pje", priority: 65, config: { fallbackFamilies: ["datajud"] } }),
  makeTribunal({ tribunalId: "trt23", nome: "TRT 23ª Região", ramo: "trabalhista", ufScope: "MT", connectorFamily: "pje", priority: 65, config: { fallbackFamilies: ["datajud"] } }),
  makeTribunal({ tribunalId: "trt24", nome: "TRT 24ª Região", ramo: "trabalhista", ufScope: "MS", connectorFamily: "pje", priority: 65, config: { fallbackFamilies: ["datajud"] } }),
];

const TJS = [
  ["tjac", "Tribunal de Justiça do Acre", "AC", "esaj"],
  ["tjal", "Tribunal de Justiça de Alagoas", "AL", "esaj"],
  ["tjam", "Tribunal de Justiça do Amazonas", "AM", "esaj"],
  ["tjap", "Tribunal de Justiça do Amapá", "AP", "pje"],
  ["tjba", "Tribunal de Justiça da Bahia", "BA", "pje"],
  ["tjce", "Tribunal de Justiça do Ceará", "CE", "esaj"],
  ["tjdft", "Tribunal de Justiça do Distrito Federal e Territórios", "DF", "pje"],
  ["tjes", "Tribunal de Justiça do Espírito Santo", "ES", "pje"],
  ["tjgo", "Tribunal de Justiça de Goiás", "GO", "pje"],
  ["tjma", "Tribunal de Justiça do Maranhão", "MA", "pje"],
  ["tjmg", "Tribunal de Justiça de Minas Gerais", "MG", "pje"],
  ["tjms", "Tribunal de Justiça do Mato Grosso do Sul", "MS", "esaj"],
  ["tjmt", "Tribunal de Justiça do Mato Grosso", "MT", "pje"],
  ["tjpa", "Tribunal de Justiça do Pará", "PA", "pje"],
  ["tjpb", "Tribunal de Justiça da Paraíba", "PB", "pje"],
  ["tjpe", "Tribunal de Justiça de Pernambuco", "PE", "pje"],
  ["tjpi", "Tribunal de Justiça do Piauí", "PI", "pje"],
  ["tjpr", "Tribunal de Justiça do Paraná", "PR", "projudi"],
  ["tjrj", "Tribunal de Justiça do Rio de Janeiro", "RJ", "pje"],
  ["tjrn", "Tribunal de Justiça do Rio Grande do Norte", "RN", "pje"],
  ["tjro", "Tribunal de Justiça de Rondônia", "RO", "pje"],
  ["tjrr", "Tribunal de Justiça de Roraima", "RR", "pje"],
  ["tjrs", "Tribunal de Justiça do Rio Grande do Sul", "RS", "eproc"],
  ["tjsc", "Tribunal de Justiça de Santa Catarina", "SC", "eproc"],
  ["tjse", "Tribunal de Justiça de Sergipe", "SE", "pje"],
  ["tjsp", "Tribunal de Justiça de São Paulo", "SP", "esaj"],
  ["tjto", "Tribunal de Justiça do Tocantins", "TO", "eproc"],
].map(([tribunalId, nome, ufScope, connectorFamily]) =>
  makeTribunal({
    tribunalId,
    nome,
    ramo: "estadual",
    ufScope,
    connectorFamily,
    priority: 85,
    config:
      tribunalId === "tjsp"
        ? { fallbackFamilies: ["datajud"], timeoutMs: 20000 }
        : { fallbackFamilies: ["datajud"] },
  }),
);

const TRES = [
  "ac","al","am","ap","ba","ce","df","es","go","ma","mg","ms","mt","pa","pb","pe","pi","pr","rj","rn","ro","rr","rs","sc","se","sp","to",
].map((uf) =>
  makeTribunal({
    tribunalId: `tre-${uf}`,
    nome: `Tribunal Regional Eleitoral ${uf.toUpperCase()}`,
    ramo: "eleitoral",
    ufScope: uf.toUpperCase(),
    connectorFamily: "custom",
    queryModes: TRIBUNAL_QUERY_MODES_NAME_OR_PROCESS,
    priority: 40,
    config: { fallbackFamilies: ["datajud"], notes: "Consulta eleitoral pública varia por tribunal" },
  }),
);

export const TRIBUNAL_CATALOG_VERSION = (process.env.TRIBUNAL_CATALOG_VERSION ?? "2026.02.27.2").trim();

export const TRIBUNAL_CATALOG_DEFAULT = [
  ...SUPERIORES,
  ...TRFS,
  ...TRTS,
  ...TJS,
  ...TRES,
];

export function getDefaultTribunalCatalog() {
  return TRIBUNAL_CATALOG_DEFAULT.map((item) => ({
    ...item,
    query_modes_supported_json: Array.isArray(item.query_modes_supported_json)
      ? [...item.query_modes_supported_json]
      : [],
    config_json: { ...(item.config_json ?? {}) },
  }));
}
