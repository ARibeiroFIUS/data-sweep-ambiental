export const ENV_RULE_CATALOG_VERSION = (process.env.ENV_RULE_CATALOG_VERSION ?? "2026.03.05.1").trim();

const RULES = [
  {
    rule_id: "federal.ibama.ctf_app.base",
    jurisdicao: "federal",
    esfera: "federal",
    base_legal: [
      "Lei no 6.938/1981 (Anexo VIII)",
      "IN Ibama no 13/2021",
      "IN Ibama no 12/2018",
    ],
    condicao: "Atividade potencialmente poluidora identificada por CNAE/descricao e evidencias de FTE",
    severidade: "alto",
    obrigacao_resultante: "Verificar enquadramento em FTE e, quando aplicavel, manter inscricao e regularidade no CTF/APP.",
  },
  {
    rule_id: "state.sp.cetesb.anexo5",
    jurisdicao: "estadual:SP",
    esfera: "estadual",
    base_legal: [
      "Lei Estadual SP no 997/76",
      "Decreto SP no 8.468/76",
      "Decreto SP no 47.397/02",
    ],
    condicao: "CNAE aderente a atividades tratadas como fonte de poluicao no estado de SP",
    severidade: "alto",
    obrigacao_resultante: "Avaliar necessidade de LP/LI/LO junto a CETESB, inclusive precedencia de LP quando aplicavel.",
  },
  {
    rule_id: "state.default.manual",
    jurisdicao: "estadual:*",
    esfera: "estadual",
    base_legal: ["Normas estaduais de licenciamento ambiental da UF competente"],
    condicao: "UF sem conector estruturado no motor automatico",
    severidade: "medio",
    obrigacao_resultante: "Executar checklist assistido com fonte oficial da secretaria/orgão ambiental estadual.",
  },
  {
    rule_id: "municipal.sp.consema_012024",
    jurisdicao: "municipal:SP",
    esfera: "municipal",
    base_legal: [
      "LC no 140/2011",
      "DN CONSEMA SP no 01/2024",
    ],
    condicao: "Atividade de impacto local conforme tipologia municipal aplicavel em SP",
    severidade: "medio",
    obrigacao_resultante: "Definir competencia municipal x CETESB e rito de licenciamento conforme habilitacao do municipio.",
  },
  {
    rule_id: "municipal.default.manual",
    jurisdicao: "municipal:*",
    esfera: "municipal",
    base_legal: ["LC no 140/2011", "Normas municipais aplicaveis"],
    condicao: "Municipio sem conector estruturado no motor automatico",
    severidade: "baixo",
    obrigacao_resultante: "Executar checklist assistido do licenciamento local com validacao documental.",
  },
  {
    rule_id: "territorial.sp.areas_contaminadas",
    jurisdicao: "ambiental_territorial:SP",
    esfera: "ambiental_territorial",
    base_legal: [
      "Lei Estadual SP no 13.577/2009",
      "Decreto SP no 59.263/2013",
      "Base publica SEMIL/CETESB - Areas Contaminadas",
    ],
    condicao: "Match geoespacial/textual com empreendimentos em base oficial de areas contaminadas",
    severidade: "alto",
    obrigacao_resultante: "Avaliar passivos, medidas de gerenciamento e restricoes de uso aplicaveis a localizacao alvo.",
  },
  {
    rule_id: "territorial.default.manual",
    jurisdicao: "ambiental_territorial:*",
    esfera: "ambiental_territorial",
    base_legal: ["Normas estaduais/municipais de qualidade do solo e passivos ambientais"],
    condicao: "UF sem base geoespacial estruturada integrada",
    severidade: "medio",
    obrigacao_resultante: "Consulta assistida em portais oficiais e registro auditavel da diligencia.",
  },
];

function normalizeUf(uf) {
  return String(uf ?? "").trim().toUpperCase();
}

export function getEnvironmentalRuleCatalog({ uf } = {}) {
  const normalizedUf = normalizeUf(uf);
  const scopedRules = RULES.filter((rule) => {
    if (!normalizedUf) return true;
    return (
      rule.jurisdicao === "federal" ||
      rule.jurisdicao.endsWith(":*") ||
      rule.jurisdicao === `estadual:${normalizedUf}` ||
      rule.jurisdicao === `municipal:${normalizedUf}` ||
      rule.jurisdicao === `ambiental_territorial:${normalizedUf}`
    );
  });

  return {
    version: ENV_RULE_CATALOG_VERSION,
    rules: scopedRules,
  };
}

export function findRuleById(ruleId) {
  return RULES.find((rule) => rule.rule_id === ruleId) ?? null;
}
