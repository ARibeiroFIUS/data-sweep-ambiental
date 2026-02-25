export function calculateScore(flags) {
  const totalWeight = flags.reduce((sum, flag) => sum + flag.weight, 0);
  const score = Math.min(100, totalWeight);

  let classification = "Baixo";
  if (score >= 75) classification = "Crítico";
  else if (score >= 50) classification = "Alto";
  else if (score >= 25) classification = "Médio";

  return { score, classification };
}
