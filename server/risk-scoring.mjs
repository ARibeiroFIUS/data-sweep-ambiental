/**
 * Scoring graph-aware (v3)
 *
 * Regras:
 * - Penaliza mais a empresa raiz (depth 0) e reduz impacto de nós indiretos.
 * - Aplicar retorno decrescente para flags repetidas da mesma natureza.
 * - Cap por família para evitar inflação por padrões estruturais repetitivos.
 * - Subscores por categoria: integridade, judicial, trabalhista, financeiro, rede.
 * - Explicabilidade: top contribuidores para o score.
 */

const CONFIDENCE_FACTORS = {
  CONFIRMADO: 1.0,
  PROVAVEL: 0.7,
  POSSIVEL: 0.0,
};

function depthFactor(depth) {
  const d = typeof depth === "number" ? depth : 0;
  if (d <= 0) return 1.0;
  if (d === 1) return 0.6;
  if (d === 2) return 0.35;
  return 0.15;
}

/**
 * Calcula confidence_factor com base no campo confidence_level do flag.
 * Flags sem confidence_level (dados objetivos) recebem fator 1.0.
 * @param {string|undefined} confidenceLevel
 * @returns {number}
 */
function confidenceFactor(confidenceLevel) {
  return CONFIDENCE_FACTORS[confidenceLevel] ?? 1.0;
}

function verificationFactor(verificationStatus) {
  const normalized = String(verificationStatus ?? "").toLowerCase();
  if (normalized === "possible") return 0;
  if (normalized === "probable") return 0.7;
  return 1.0;
}

function repetitionFactor(repetitionIndex) {
  if (repetitionIndex <= 0) return 1.0;
  if (repetitionIndex === 1) return 0.6;
  return 0.3;
}

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function riskFamily(flag) {
  const sourceId = normalizeText(flag?.source_id);
  const source = normalizeText(flag?.source);
  const title = normalizeText(flag?.title);

  if (
    sourceId === "network" ||
    source.includes("padroes de rede") ||
    title.includes("socio conectado a multiplas empresas")
  ) {
    return "network_patterns";
  }

  return "default";
}

function repetitionKey(flag) {
  const titleKey = normalizeText(flag?.title || flag?.id || "");
  if (!titleKey) return null;
  const sourceKey = normalizeText(flag?.source_id || flag?.source || "source");
  return `${sourceKey}|${titleKey}`;
}

const FAMILY_CAPS = {
  network_patterns: 15,
};

// ─────────────────────────────────────────────────────────────────────────────
// Mapeamento de source_id → categoria de subscore
// ─────────────────────────────────────────────────────────────────────────────

const SOURCE_ID_TO_SUBSCORE = {
  // Integridade / Sanções federais
  cgu_ceis: "integridade",
  cgu_cnep: "integridade",
  cgu_cepim: "integridade",
  cgu_acordos_leniencia: "integridade",
  cgu_ceaf: "integridade",
  tcu_licitantes: "integridade",
  cvm_sancoes: "integridade",
  bacen_sancoes: "integridade",

  // Trabalhista / ESG
  mte_trabalho_escravo: "trabalhista",
  mte_autuacoes: "trabalhista",

  // Financeiro / Solvência
  pgfn_fgts: "financeiro",
  pgfn_previdenciario: "financeiro",
  pgfn_nao_previdenciario: "financeiro",
  cndl_protestos: "financeiro",

  // Judicial (DataJud)
  datajud: "judicial",

  // Rede societária (heurísticas estruturais)
  network: "rede",
};

/**
 * Determina a categoria de subscore de um flag.
 * Flags de sócios (depth > 0) sempre vão para a categoria "rede".
 */
function subscoreCategory(flag) {
  const depth = typeof flag?.depth === "number" ? flag.depth : 0;
  if (depth > 0) return "rede";

  const sourceId = String(flag?.source_id ?? "").toLowerCase();
  const source = String(flag?.source ?? "").toLowerCase();

  if (sourceId === "network" || source.includes("padrões de rede") || source.includes("padroes de rede")) {
    return "rede";
  }

  return SOURCE_ID_TO_SUBSCORE[sourceId] ?? "integridade";
}

// ─────────────────────────────────────────────────────────────────────────────
// Núcleo de cálculo — usado por calculateScore e calculateSubscores
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Itera os flags e retorna as contribuições efetivas de cada um,
 * respeitando repetição, cap por família e todos os fatores.
 */
function computeContributions(flags) {
  const repetitionCount = new Map();
  const familyTotals = new Map();
  const contributions = [];

  for (const flag of Array.isArray(flags) ? flags : []) {
    const w = typeof flag.weight === "number" ? flag.weight : 0;
    const df = depthFactor(flag.depth);
    const cf = confidenceFactor(flag.confidence_level);
    const vf = verificationFactor(flag.verification_status);
    const raw = w * df * cf * vf;

    const key = repetitionKey(flag);
    let repeated = raw;
    if (key) {
      const idx = repetitionCount.get(key) ?? 0;
      repetitionCount.set(key, idx + 1);
      repeated = raw * repetitionFactor(idx);
    }

    const family = riskFamily(flag);
    const cap = FAMILY_CAPS[family] ?? Number.POSITIVE_INFINITY;
    const used = familyTotals.get(family) ?? 0;
    const allowed = Math.max(0, cap - used);
    const applied = Math.min(repeated, allowed);
    familyTotals.set(family, used + applied);

    contributions.push({ flag, effective: applied });
  }

  return contributions;
}

function classifyScore(score) {
  if (score >= 70) return "Crítico";
  if (score >= 45) return "Alto";
  if (score >= 20) return "Médio";
  return "Baixo";
}

// ─────────────────────────────────────────────────────────────────────────────
// API pública
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calcula score e classificação de risco com graph-aware weighting.
 * Também retorna os top contribuidores para explicabilidade.
 *
 * @param {Array<{weight: number, depth?: number, confidence_level?: string, verification_status?: string}>} flags
 * @returns {{ score: number, classification: string, top_risks: Array }}
 */
export function calculateScore(flags) {
  const contributions = computeContributions(flags);
  const adjustedTotal = contributions.reduce((sum, c) => sum + c.effective, 0);
  const score = Math.min(100, Math.round(adjustedTotal));
  const classification = classifyScore(score);

  const topRisks = contributions
    .filter((c) => c.effective > 0)
    .sort((a, b) => b.effective - a.effective)
    .slice(0, 3)
    .map((c) => ({
      id: c.flag.id ?? "",
      title: c.flag.title ?? "",
      source: c.flag.source ?? "",
      effective_weight: Math.round(c.effective * 10) / 10,
    }));

  return { score, classification, top_risks: topRisks };
}

/**
 * Calcula subscores por categoria para o conjunto de flags.
 * Retorna um objeto com 5 dimensões: integridade, judicial, trabalhista, financeiro, rede.
 *
 * @param {Array} flags
 * @returns {{ score_integridade, score_judicial, score_trabalhista, score_financeiro, score_rede }}
 */
export function calculateSubscores(flags) {
  const DIMS = ["integridade", "judicial", "trabalhista", "financeiro", "rede"];
  const byDim = Object.fromEntries(DIMS.map((d) => [d, []]));

  for (const flag of Array.isArray(flags) ? flags : []) {
    const cat = subscoreCategory(flag);
    (byDim[cat] ?? byDim.integridade).push(flag);
  }

  return Object.fromEntries(
    DIMS.map((d) => {
      const { score, classification } = calculateScore(byDim[d]);
      return [
        `score_${d}`,
        { score, classification, flag_count: byDim[d].length },
      ];
    }),
  );
}

/**
 * Calcula score parcial para um conjunto de flags de sócio/parceira (depth=1).
 * Útil para exibir o risco individual de cada empresa parceira.
 *
 * @param {Array} flags
 * @returns {{ score: number, classification: string }}
 */
export function calculatePartnerScore(flags) {
  return calculateScore(flags);
}
