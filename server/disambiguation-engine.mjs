/**
 * Motor de Desambiguação — spec SUPPLY_RISK_MAPPING_SPEC Seção 5
 *
 * Algoritmo de 5 camadas para validar se um resultado de busca por nome
 * corresponde realmente ao sócio investigado, mesmo quando o CPF está mascarado.
 *
 * Levels: CONFIRMADO (≥0.85) | PROVAVEL (0.60–0.84) | POSSIVEL (0.40–0.59) | DESCARTADO (<0.40)
 * Especial: HOMONIMO_CERTO — CPF disponível e diverge (mesma UF, mesmo nome ≠ CPF)
 */

// ─────────────────────────────────────────────────────────────────────────────
// Listas de nomes muito comuns no Brasil (primeiros nomes + sobrenomes)
// Usado pelo Layer 4 para multiplicador de raridade
// ─────────────────────────────────────────────────────────────────────────────

const VERY_COMMON_FIRST_NAMES = new Set([
  "JOSE", "JOAO", "ANTONIO", "FRANCISCO", "CARLOS", "PAULO", "PEDRO",
  "LUCAS", "LUIZ", "MARCOS", "LUIS", "GABRIEL", "RAFAEL", "DANIEL", "MARCELO",
  "BRUNO", "EDUARDO", "FELIPE", "RAIMUNDO", "RODRIGO", "ANA", "MARIA", "FRANCISCA",
  "ANTONIA", "ADRIANA", "JULIANA", "MARCIA", "FERNANDA", "PATRICIA", "ALINE",
  "SANDRA", "CAMILA", "AMANDA", "BRUNA", "JESSICA", "LETICIA", "JULIA", "LUCIANA",
  "VANESSA", "MARIANA", "CLAUDIA", "CRISTINA",
]);

const VERY_COMMON_SURNAMES = new Set([
  "SILVA", "SANTOS", "OLIVEIRA", "SOUZA", "RODRIGUES", "FERREIRA", "ALVES",
  "PEREIRA", "LIMA", "GOMES", "COSTA", "RIBEIRO", "MARTINS", "CARVALHO",
  "ALMEIDA", "LOPES", "SOUSA", "FERNANDES", "VIEIRA", "BARBOSA", "ROCHA",
  "DIAS", "NASCIMENTO", "ANDRADE", "MOREIRA", "NUNES", "MARQUES", "MACHADO",
  "MENDES", "FREITAS", "CAVALCANTI", "CARDOSO", "TEIXEIRA", "REZENDE",
]);

// ─────────────────────────────────────────────────────────────────────────────
// Utilitários
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Normaliza nome: upper, sem acento, sem pontuação, colapsa espaços
 */
function normalizeName(name) {
  if (!name) return "";
  return name
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Extrai os 6 primeiros dígitos de um CPF (removes masks like ***.***.123-**)
 */
function extractCpf6Digits(cpfStr) {
  if (!cpfStr) return null;
  const digits = cpfStr.replace(/\D/g, "");
  if (digits.length < 6) return null;
  // Check for masked format — non-zero digits must be the core
  const allDigits = cpfStr.replace(/[^0-9*]/g, "");
  // If starts with *** it's masked from beginning — we can't extract leading digits
  if (allDigits.startsWith("*")) return null;
  return digits.substring(0, 6);
}

// ─────────────────────────────────────────────────────────────────────────────
// Layer 4 — Raridade do nome
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Classifica a raridade de um nome completo.
 * Nomes compostos de partes muito comuns = MUITO_COMUM.
 * @returns {"MUITO_COMUM"|"COMUM"|"MEDIO"|"RARO"}
 */
export function extractNameRarity(fullName) {
  const parts = normalizeName(fullName).split(" ").filter(Boolean);
  if (parts.length === 0) return "MEDIO";

  const firstName = parts[0];
  const surname = parts[parts.length - 1];

  const firstIsCommon = VERY_COMMON_FIRST_NAMES.has(firstName);
  const lastIsCommon = VERY_COMMON_SURNAMES.has(surname);

  // Se tem 2+ partes do meio também comuns
  const middleCommonCount = parts
    .slice(1, -1)
    .filter((p) => VERY_COMMON_SURNAMES.has(p) || VERY_COMMON_FIRST_NAMES.has(p)).length;

  if (firstIsCommon && lastIsCommon) return "MUITO_COMUM";
  if (firstIsCommon || lastIsCommon) {
    return middleCommonCount >= 1 ? "MUITO_COMUM" : "COMUM";
  }
  if (middleCommonCount >= 2) return "COMUM";
  return "RARO";
}

// ─────────────────────────────────────────────────────────────────────────────
// Layer 1 — Name matching
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calcula score de similaridade de nomes (0.0–0.40).
 * @param {string} nameA
 * @param {string} nameB
 * @returns {number}
 */
function nameMatchScore(nameA, nameB) {
  const a = normalizeName(nameA);
  const b = normalizeName(nameB);
  if (!a || !b) return 0;

  // Exact match
  if (a === b) return 0.40;

  const partsA = a.split(" ").filter(Boolean);
  const partsB = b.split(" ").filter(Boolean);

  // First + last match
  if (
    partsA.length >= 2 &&
    partsB.length >= 2 &&
    partsA[0] === partsB[0] &&
    partsA[partsA.length - 1] === partsB[partsB.length - 1]
  ) {
    return 0.25;
  }

  // First name only
  if (partsA[0] === partsB[0]) return 0.10;

  // Substring: one contains the other (handles abreviações)
  if (a.includes(b) || b.includes(a)) return 0.15;

  return 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main: calculateDisambiguationScore
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calcula o score de desambiguação entre um sócio do QSA e um registro retornado
 * por uma base de sanções/servidores.
 *
 * @param {object} partnerProfile
 *   { nome: string, cpf_masked?: string, uf?: string, municipio?: string }
 * @param {object} resultRecord
 *   { nome: string, cpf?: string, uf?: string, municipio?: string }
 * @returns {{ score: number, level: string, layers: object }}
 */
export function calculateDisambiguationScore(partnerProfile, resultRecord) {
  const layers = {};

  // ── Layer 1: Name match ──────────────────────────────────────────────────
  const nameScore = nameMatchScore(partnerProfile.nome, resultRecord.nome);
  layers.name = nameScore;

  if (nameScore === 0) {
    return { score: 0, level: "DESCARTADO", layers };
  }

  let score = nameScore;

  // ── Layer 2: CPF 6 digits ────────────────────────────────────────────────
  const partnerCpf6 = extractCpf6Digits(partnerProfile.cpf_masked);
  const resultCpf = resultRecord.cpf ? resultRecord.cpf.replace(/\D/g, "") : null;

  if (partnerCpf6 && resultCpf && resultCpf.length >= 6) {
    const resultCpf6 = resultCpf.substring(0, 6);
    if (partnerCpf6 === resultCpf6) {
      score += 0.45;
      layers.cpf = "MATCH";
    } else {
      // CPF known to diverge = definitive homonym
      layers.cpf = "DIVERGE";
      return { score: 0, level: "HOMONIMO_CERTO", layers };
    }
  } else {
    layers.cpf = "UNAVAILABLE";
  }

  // ── Layer 3: Geographic ──────────────────────────────────────────────────
  const partnerUf = (partnerProfile.uf || "").toUpperCase().trim();
  const resultUf = (resultRecord.uf || "").toUpperCase().trim();

  if (partnerUf && resultUf) {
    if (partnerUf === resultUf) {
      score += 0.08;
      layers.geo = "MATCH";
    } else {
      score -= 0.03;
      layers.geo = "DIVERGE";
    }
  } else {
    layers.geo = "UNAVAILABLE";
  }

  // ── Layer 4: Name rarity ─────────────────────────────────────────────────
  const rarity = extractNameRarity(partnerProfile.nome);
  layers.rarity = rarity;
  const rarityMultiplier = {
    RARO: 1.15,
    MEDIO: 1.0,
    COMUM: 0.80,
    MUITO_COMUM: 0.65,
  }[rarity] ?? 1.0;

  score = score * rarityMultiplier;

  // ── Clamp + classify ─────────────────────────────────────────────────────
  score = Math.min(1.0, Math.max(0, score));
  layers.final_before_convergence = score;

  const level = scoreToLevel(score);

  return { score, level, layers };
}

/**
 * Converte score numérico para nível textual (sem convergence bonus).
 */
function scoreToLevel(score) {
  if (score >= 0.85) return "CONFIRMADO";
  if (score >= 0.60) return "PROVAVEL";
  if (score >= 0.40) return "POSSIVEL";
  return "DESCARTADO";
}

// ─────────────────────────────────────────────────────────────────────────────
// Layer 5: Cross-source convergence bonus
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Aplica bônus de convergência quando o mesmo nome aparece em múltiplas fontes.
 *
 * @param {Array<{ score: number, level: string, source: string, layers: object }>} matches
 * @returns {Array<{ score: number, level: string, source: string, layers: object, convergence_bonus: number }>}
 */
export function applyConvergenceBonus(matches) {
  if (!matches || matches.length === 0) return matches;

  const validMatches = matches.filter((m) => m.level !== "DESCARTADO" && m.level !== "HOMONIMO_CERTO");
  const sourceCount = new Set(validMatches.map((m) => m.source)).size;

  let bonus = 0;
  if (sourceCount >= 3) bonus = 0.15;
  else if (sourceCount >= 2) bonus = 0.08;

  return matches.map((m) => {
    if (m.level === "DESCARTADO" || m.level === "HOMONIMO_CERTO") {
      return { ...m, convergence_bonus: 0 };
    }
    const newScore = Math.min(1.0, m.score + bonus);
    return {
      ...m,
      score: newScore,
      level: scoreToLevel(newScore),
      convergence_bonus: bonus,
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers for callers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Retorna o melhor match de uma lista (maior score não-descartado).
 * @param {Array} matches
 * @returns {{ score, level, source, ... } | null}
 */
export function bestMatch(matches) {
  if (!matches || matches.length === 0) return null;
  const valid = matches.filter((m) => m.level !== "DESCARTADO" && m.level !== "HOMONIMO_CERTO");
  if (valid.length === 0) return null;
  return valid.reduce((best, m) => (m.score > best.score ? m : best), valid[0]);
}
