/**
 * Scoring graph-aware (v2)
 *
 * Regras:
 * - Penaliza mais a empresa raiz (depth 0) e reduz impacto de nós indiretos.
 * - Aplicar retorno decrescente para flags repetidas da mesma natureza.
 * - Cap por família para evitar inflação por padrões estruturais repetitivos.
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

/**
 * Calcula score e classificação de risco com graph-aware weighting.
 *
 * @param {Array<{weight: number, depth?: number, confidence_level?: string, verification_status?: string}>} flags
 * @returns {{ score: number, classification: string }}
 */
export function calculateScore(flags) {
  const repetitionCount = new Map();
  const familyTotals = new Map();

  const adjustedTotal = (Array.isArray(flags) ? flags : []).reduce((sum, flag) => {
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

    return sum + applied;
  }, 0);

  const score = Math.min(100, Math.round(adjustedTotal));

  let classification = "Baixo";
  if (score >= 70) classification = "Crítico";
  else if (score >= 45) classification = "Alto";
  else if (score >= 20) classification = "Médio";

  return { score, classification };
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
