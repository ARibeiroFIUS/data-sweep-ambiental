import { parseBooleanEnv } from "./common-utils.mjs";

export const SOURCES_VERSION = (process.env.SOURCES_VERSION ?? "2026.02.25.1").trim();

export const SOURCE_REGISTRY = {
  receita_brasilapi: {
    id: "receita_brasilapi",
    name: "Receita Federal (BrasilAPI)",
    timeoutMs: 10000,
    ttlMs: 0,
    featureFlag: "FEATURE_RECEITA_BRASILAPI",
  },
  cgu_ceis: {
    id: "cgu_ceis",
    name: "CEIS — Empresas Inidôneas e Suspensas",
    timeoutMs: 15000,
    ttlMs: 0,
    featureFlag: "FEATURE_CGU_CEIS",
  },
  cgu_cnep: {
    id: "cgu_cnep",
    name: "CNEP — Empresas Punidas",
    timeoutMs: 15000,
    ttlMs: 0,
    featureFlag: "FEATURE_CGU_CNEP",
  },
  cgu_cepim: {
    id: "cgu_cepim",
    name: "CEPIM — Entidades Impedidas",
    timeoutMs: 15000,
    ttlMs: 0,
    featureFlag: "FEATURE_CGU_CEPIM",
  },
  cgu_acordos_leniencia: {
    id: "cgu_acordos_leniencia",
    name: "CGU — Acordos de Leniência",
    timeoutMs: 15000,
    ttlMs: 0,
    featureFlag: "FEATURE_CGU_ACORDOS_LENIENCIA",
  },
  cgu_ceaf: {
    id: "cgu_ceaf",
    name: "CEAF — Expulsões da Administração Federal",
    timeoutMs: 15000,
    ttlMs: 0,
    featureFlag: "FEATURE_CGU_CEAF",
  },
  cgu_servidores: {
    id: "cgu_servidores",
    name: "Servidores Federais (CGU)",
    timeoutMs: 15000,
    ttlMs: 0,
    featureFlag: "FEATURE_CGU_SERVIDORES",
  },
  tcu_licitantes: {
    id: "tcu_licitantes",
    name: "TCU — Licitantes Inidôneos",
    timeoutMs: 15000,
    ttlMs: 6 * 60 * 60 * 1000,
    featureFlag: "FEATURE_TCU_LICITANTES",
  },
  tcu_eleitoral: {
    id: "tcu_eleitoral",
    name: "TCU — Contas Irregulares com Implicação Eleitoral",
    timeoutMs: 15000,
    ttlMs: 6 * 60 * 60 * 1000,
    featureFlag: "FEATURE_TCU_ELEITORAL",
  },
  mte_trabalho_escravo: {
    id: "mte_trabalho_escravo",
    name: "MTE — Cadastro de Empregadores (Trabalho Escravo)",
    timeoutMs: 20000,
    ttlMs: 6 * 60 * 60 * 1000,
    featureFlag: "FEATURE_MTE_TRABALHO_ESCRAVO",
  },
  pgfn_fgts: {
    id: "pgfn_fgts",
    name: "PGFN — Dívida Ativa (FGTS)",
    timeoutMs: 4000,
    ttlMs: 0,
    featureFlag: "FEATURE_PGFN_FGTS",
  },
  pgfn_previdenciario: {
    id: "pgfn_previdenciario",
    name: "PGFN — Dívida Ativa Previdenciária",
    timeoutMs: 4000,
    ttlMs: 0,
    featureFlag: "FEATURE_PGFN_PREVIDENCIARIO",
  },
  pgfn_nao_previdenciario: {
    id: "pgfn_nao_previdenciario",
    name: "PGFN — Dívida Ativa Não-Previdenciária",
    timeoutMs: 4000,
    ttlMs: 0,
    featureFlag: "FEATURE_PGFN_NAO_PREVIDENCIARIO",
  },
};

export const PGFN_SOURCE_IDS = [
  "pgfn_fgts",
  "pgfn_previdenciario",
  "pgfn_nao_previdenciario",
];

export function getSourceConfig(sourceId) {
  const source = SOURCE_REGISTRY[sourceId];
  if (!source) {
    throw new Error(`Fonte não registrada: ${sourceId}`);
  }
  return source;
}

export function isSourceEnabled(sourceId) {
  const source = getSourceConfig(sourceId);
  return parseBooleanEnv(process.env[source.featureFlag], true);
}

export function getSourceIds() {
  return Object.keys(SOURCE_REGISTRY);
}
