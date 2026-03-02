/**
 * Módulo de Síntese IA
 *
 * Provider primário: OpenAI (OPENAI_API_KEY)
 * Fallback: Anthropic (ANTHROPIC_API_KEY)
 *
 * Gera laudo investigativo em português com 3 seções:
 *   1. RESUMO EXECUTIVO
 *   2. ANÁLISE DETALHADA
 *   3. RECOMENDAÇÕES
 *
 * Fail-open: se a API falhar, retorna { available: false, reason: "..." }
 */

import Anthropic from "@anthropic-ai/sdk";

const OPENAI_MODEL = (process.env.OPENAI_MODEL ?? "gpt-4o-mini").trim();
const ANTHROPIC_MODEL = (process.env.ANTHROPIC_MODEL ?? "claude-opus-4-6").trim();
const TIMEOUT_MS = 45_000;

const SYSTEM_PROMPT = `Você é analista sênior de compliance e risco especializado em due diligence de empresas brasileiras.

Sua função é analisar os dados fornecidos e produzir um laudo investigativo objetivo e profissional em português do Brasil.

FORMATO OBRIGATÓRIO — responda EXATAMENTE com estas 3 seções, usando os títulos exatamente como abaixo:

## RESUMO EXECUTIVO
(2-3 parágrafos: avaliação do risco geral, principais achados relevantes, recomendação final clara.
Mencione os subscores mais elevados e os top fatores de risco quando disponíveis.)

## ANÁLISE DETALHADA
(Por categoria de risco — mencione APENAS categorias com achados concretos):
- Integridade / Sanções (CEIS, CNEP, CEAF, CEPIM, TCU, CVM, BACEN)
- Judicial (processos criminais, execuções fiscais, falência, recuperação judicial via DataJud/CNJ)
- Financeiro (dívida ativa PGFN, protestos, inadimplência)
- Trabalhista / ESG (MTE, trabalho escravo, autuações, passivos trabalhistas)
- Rede societária (sócios com sanções, padrões estruturais suspeitos, profundidade da rede)

## RECOMENDAÇÕES
(Lista priorizada de ações específicas — seja direto e objetivo)

INSTRUÇÕES:
- Use linguagem técnica mas acessível
- Cite fontes específicas quando relevar (ex: "consta no CEIS", "registrado no MTE")
- Para cada conclusão relevante, cite flag_id e quantidade de evidências quando disponível
- Para flags com confidence_level PROVAVEL ou POSSIVEL, mencione a incerteza explicitamente
- Se não há achados em uma categoria, simplesmente não inclua essa categoria na Análise Detalhada
- Seja objetivo: não invente informações que não estão nos dados
- Mantenha o laudo entre 300 e 600 palavras`;

/**
 * Formata os dados da empresa para o prompt.
 */
function buildPrompt(synthesisInput) {
  const { company, flags, sources, score, classification, subscores, score_explanation, peer_benchmark, partnerCompanies, pfPartnerResults } =
    synthesisInput;

  const lines = [];

  // ── Empresa ──────────────────────────────────────────────────────────────
  lines.push("# DADOS DA EMPRESA INVESTIGADA");
  lines.push(`Razão Social: ${company.razao_social}`);
  lines.push(`CNPJ: ${company.cnpj}`);
  lines.push(`Nome Fantasia: ${company.nome_fantasia || "—"}`);
  lines.push(`Situação Cadastral: ${company.situacao_cadastral}`);
  lines.push(`CNAE: ${company.cnae_fiscal_descricao} (${company.cnae_fiscal})`);
  lines.push(`Capital Social: R$ ${(company.capital_social ?? 0).toLocaleString("pt-BR")}`);
  lines.push(`Porte: ${company.porte || "—"}`);
  lines.push(`UF: ${company.uf} — Município: ${company.municipio}`);
  lines.push(`Início de Atividade: ${company.data_inicio_atividade || "—"}`);
  lines.push(`Natureza Jurídica: ${company.natureza_juridica || "—"}`);
  lines.push("");

  // ── Score ─────────────────────────────────────────────────────────────────
  lines.push(`# SCORE DE RISCO`);
  lines.push(`Score total: ${score} / 100 — ${classification}`);

  if (subscores) {
    lines.push("Subscores por categoria:");
    const dimLabels = {
      score_integridade: "Integridade/Sanções",
      score_judicial: "Judicial",
      score_trabalhista: "Trabalhista/ESG",
      score_financeiro: "Financeiro/Solvência",
      score_rede: "Rede societária",
    };
    for (const [key, label] of Object.entries(dimLabels)) {
      const dim = subscores[key];
      if (dim) {
        lines.push(`  ${label}: ${dim.score}/100 (${dim.classification}) — ${dim.flag_count} flag(s)`);
      }
    }
  }

  if (score_explanation?.top_risks?.length > 0) {
    lines.push("Top fatores de risco:");
    for (const r of score_explanation.top_risks) {
      lines.push(`  1. ${r.title} (+${r.effective_weight}pts efetivos) [flag_id=${r.id}]`);
    }
  }

  if (peer_benchmark?.sample_size && peer_benchmark?.top_risk_percent != null) {
    lines.push(
      `Benchmark CNAE ${peer_benchmark.cnae}: top ${peer_benchmark.top_risk_percent}% de risco ` +
      `em amostra de ${peer_benchmark.sample_size} empresa(s) (média do segmento: ${peer_benchmark.avg_score}).`,
    );
  }

  lines.push("");

  // ── QSA ──────────────────────────────────────────────────────────────────
  if (company.qsa && company.qsa.length > 0) {
    lines.push("# QUADRO SOCIETÁRIO (QSA)");
    for (const partner of company.qsa) {
      const cpfInfo = partner.cnpj_cpf_do_socio ? ` | CPF/CNPJ: ${partner.cnpj_cpf_do_socio}` : "";
      lines.push(`- ${partner.nome} (${partner.qual})${cpfInfo}`);
    }
    lines.push("");
  }

  // ── Flags da empresa principal ────────────────────────────────────────────
  if (flags && flags.length > 0) {
    lines.push("# FLAGS DE RISCO DETECTADOS");
    for (const flag of flags) {
      const depth = flag.depth != null ? ` [depth=${flag.depth}]` : "";
      const conf = flag.confidence_level ? ` [${flag.confidence_level} — confidence=${(flag.confidence ?? 0).toFixed(2)}]` : "";
      const evidenceCount = Array.isArray(flag.evidence) ? flag.evidence.length : 0;
      lines.push(
        `- [${flag.severity.toUpperCase()}] ${flag.title} (+${flag.weight}pts) [flag_id=${flag.id}] [evidence_count=${evidenceCount}]${depth}${conf}`,
      );
      lines.push(`  Fonte: ${flag.source} | ${flag.description}`);
      if (flag.evidence && flag.evidence.length > 0) {
        for (const ev of flag.evidence.slice(0, 3)) {
          lines.push(`  * ${ev.label}: ${ev.value}`);
        }
      }
    }
    lines.push("");
  } else {
    lines.push("# FLAGS DE RISCO DETECTADOS");
    lines.push("Nenhum flag de risco encontrado nas bases consultadas.");
    lines.push("");
  }

  // ── Sócios PJ (parceiras investigadas) ───────────────────────────────────
  const partnerItems = partnerCompanies?.items ?? [];
  const partnerItemsWithRisk = partnerItems.filter(
    (p) => p.risk_flags && p.risk_flags.length > 0,
  );
  if (partnerItemsWithRisk.length > 0) {
    lines.push("# RISCOS EM SÓCIOS PJ");
    for (const partner of partnerItemsWithRisk) {
      lines.push(`Sócio PJ: ${partner.razao_social} (CNPJ: ${partner.cnpj})`);
      lines.push(`Score: ${partner.risk_score ?? 0} — ${partner.risk_classification ?? "—"}`);
      for (const f of partner.risk_flags) {
        lines.push(`  - [${f.severity?.toUpperCase()}] ${f.title} (+${f.weight}pts)`);
      }
    }
    lines.push("");
  }

  // ── Sócios PF (buscas por nome com confidence) ────────────────────────────
  if (pfPartnerResults && pfPartnerResults.length > 0) {
    lines.push("# RISCOS EM SÓCIOS PF (por nome — confidence levels)");
    for (const pf of pfPartnerResults) {
      if (!pf.matches || pf.matches.length === 0) continue;
      const validMatches = pf.matches.filter((m) => m.level !== "DESCARTADO" && m.level !== "HOMONIMO_CERTO");
      if (validMatches.length === 0) continue;
      lines.push(`Sócio: ${pf.partner_name}`);
      for (const match of validMatches) {
        lines.push(`  - [${match.level}] ${match.flag_title} — Fonte: ${match.source}`);
        lines.push(`    Score desambiguação: ${(match.score ?? 0).toFixed(2)}`);
      }
    }
    lines.push("");
  }

  // ── Fontes com falha ─────────────────────────────────────────────────────
  const failedSources = (sources ?? []).filter(
    (s) => s.status === "error" || s.status === "unavailable",
  );
  if (failedSources.length > 0) {
    lines.push("# FONTES INDISPONÍVEIS (limitações desta análise)");
    for (const src of failedSources) {
      lines.push(`- ${src.name}: ${src.status}${src.message ? ` — ${src.message}` : ""}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Gera laudo investigativo usando OpenAI (primário) ou Anthropic (fallback).
 *
 * @param {object} synthesisInput
 * @returns {Promise<{available: boolean, narrative?: string, model?: string, reason?: string, input_tokens?: number, output_tokens?: number}>}
 */
export async function generateIntelligenceReport(synthesisInput) {
  const openAiKey = (process.env.OPENAI_API_KEY ?? "").trim();
  const anthropicKey = (process.env.ANTHROPIC_API_KEY ?? "").trim();
  const userPrompt = buildPrompt(synthesisInput);

  // 1) OpenAI como provider primário
  if (openAiKey) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${openAiKey}`,
        },
        body: JSON.stringify({
          model: OPENAI_MODEL,
          temperature: 0.2,
          max_tokens: 1200,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: userPrompt },
          ],
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const errText = await response.text().catch(() => "");
        throw new Error(`OpenAI HTTP ${response.status}${errText ? ` - ${errText.slice(0, 200)}` : ""}`);
      }

      const payload = await response.json();
      const narrative = payload?.choices?.[0]?.message?.content;
      if (!narrative || typeof narrative !== "string") {
        throw new Error("OpenAI retornou resposta sem conteúdo textual");
      }

      return {
        available: true,
        narrative,
        model: OPENAI_MODEL,
        input_tokens: payload?.usage?.prompt_tokens,
        output_tokens: payload?.usage?.completion_tokens,
      };
    } catch (error) {
      console.error("[ai-synthesis] OpenAI API error:", error?.message ?? error);
      if (!anthropicKey) {
        return {
          available: false,
          reason: error?.message ?? "Erro desconhecido na API OpenAI",
        };
      }
      // segue fallback para Anthropic
    }
  }

  // 2) Fallback para Anthropic
  if (anthropicKey) {
    const client = new Anthropic({ apiKey: anthropicKey });
    try {
      const message = await client.messages.create(
        {
          model: ANTHROPIC_MODEL,
          max_tokens: 1024,
          system: SYSTEM_PROMPT,
          messages: [{ role: "user", content: userPrompt }],
        },
        { timeout: TIMEOUT_MS },
      );

      const narrative = message.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n");

      return {
        available: true,
        narrative,
        model: ANTHROPIC_MODEL,
        input_tokens: message.usage?.input_tokens,
        output_tokens: message.usage?.output_tokens,
      };
    } catch (error) {
      console.error("[ai-synthesis] Anthropic API error:", error?.message ?? error);
      return {
        available: false,
        reason: error?.message ?? "Erro desconhecido na API Anthropic",
      };
    }
  }

  return { available: false, reason: "Nenhuma chave de IA configurada (OPENAI_API_KEY/ANTHROPIC_API_KEY)" };
}
