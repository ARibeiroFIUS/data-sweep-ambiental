/**
 * Monitor Job — Watch List
 *
 * Re-analisa todos os CNPJs monitorados e dispara webhooks quando:
 *   - Score muda >= score_threshold pontos
 *   - Novo flag aparece (qualquer fonte)
 *   - Nova sanção crítica em CEIS/CNEP/TCU
 *
 * Payload do webhook (POST application/json):
 * {
 *   event:           "score_delta" | "new_flag" | "new_critical_flag",
 *   cnpj:            "14 dígitos",
 *   label:           "rótulo configurado",
 *   razao_social:    "...",
 *   previous_score:  70,
 *   current_score:   85,
 *   delta:           15,
 *   classification:  "Crítico",
 *   new_flags:       [...],   // flags que não existiam antes
 *   analyzed_at:     "ISO8601"
 * }
 */

import { analyzeCnpj } from "./analyze-cnpj.mjs";
import {
  ensureWatchListTable,
  listWatched,
  updateWatchLastResult,
} from "./watch-list-store.mjs";

const WEBHOOK_TIMEOUT_MS = 10_000;
const INTER_CNPJ_DELAY_MS = 2_000; // evita flood nos serviços externos

/** Fontes que geram sanções críticas e sempre disparam webhook */
const CRITICAL_SOURCES = new Set([
  "cgu_ceis",
  "cgu_cnep",
  "cgu_ceaf",
  "cgu_cepim",
  "tcu_licitantes",
]);

/**
 * Dispara webhook para a URL configurada no watch item.
 * Fail-open: erros são apenas logados.
 */
async function fireWebhook(webhookUrl, payload) {
  if (!webhookUrl) return;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);

    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      console.warn(`[monitor-job] webhook ${webhookUrl} returned HTTP ${res.status}`);
    } else {
      console.log(`[monitor-job] webhook fired → ${webhookUrl} (event=${payload.event})`);
    }
  } catch (error) {
    console.error(`[monitor-job] webhook error for ${webhookUrl}:`, error?.message ?? error);
  }
}

function detectNewFlags(currentFlags, previousFlagIds) {
  if (!Array.isArray(currentFlags)) return [];
  return currentFlags.filter((f) => f?.id && !previousFlagIds.has(f.id));
}

/**
 * Executa o job de monitoramento para todos os CNPJs da watch list.
 *
 * @returns {Promise<{ processed: number, triggered: number, errors: number }>}
 */
export async function runMonitorJob() {
  await ensureWatchListTable();

  const watched = await listWatched();

  if (watched.length === 0) {
    console.log("[monitor-job] Watch list vazia — nada a monitorar.");
    return { processed: 0, triggered: 0, errors: 0 };
  }

  console.log(`[monitor-job] Iniciando varredura de ${watched.length} CNPJ(s) monitorado(s)…`);

  let processed = 0;
  let triggered = 0;
  let errors = 0;

  for (const item of watched) {
    const cnpj = item.cnpj;
    const label = item.label ?? cnpj;
    const webhookUrl = item.webhook_url ?? null;
    const threshold = Number(item.score_threshold ?? 10);
    const prevScore = item.last_score != null ? Number(item.last_score) : null;

    const prevFlagsCount = item.last_flags_count != null ? Number(item.last_flags_count) : null;
    const prevFlagIds = new Set(
      Array.isArray(item.last_flag_ids_json)
        ? item.last_flag_ids_json
        : Array.isArray(item.last_flag_ids)
          ? item.last_flag_ids
          : [],
    );

    console.log(`[monitor-job] Analisando ${cnpj} (${label})…`);

    try {
      const result = await analyzeCnpj(cnpj);

      const currentScore = typeof result.score === "number" ? result.score : 0;
      const classification = result.classification ?? "Baixo";
      const currentFlags = Array.isArray(result.flags) ? result.flags : [];
      const flagsCount = currentFlags.length;
      const subscores = result.subscores ?? null;
      const razaoSocial = result.company?.razao_social ?? cnpj;

      // Persiste resultado
      await updateWatchLastResult(cnpj, {
        score: currentScore,
        classification,
        flags_count: flagsCount,
        subscores,
        flag_ids: currentFlags.map((f) => String(f?.id ?? "")).filter(Boolean),
      });

      processed++;

      // ── Determina o evento a disparar ────────────────────────────────────
      let event = null;
      let newFlags = [];

      const delta = prevScore != null ? currentScore - prevScore : 0;

      // 1. Delta de score >= threshold
      if (prevScore != null && Math.abs(delta) >= threshold) {
        event = "score_delta";
      }

      // 2. Novos flags (comparação por IDs quando disponíveis; fallback por contagem)
      if (prevFlagIds.size > 0) {
        newFlags = detectNewFlags(currentFlags, prevFlagIds);
        if (newFlags.length > 0 && !event) event = "new_flag";
      } else if (prevFlagsCount != null && flagsCount > prevFlagsCount) {
        newFlags = currentFlags.slice(prevFlagsCount);
        if (!event) event = "new_flag";
      } else if (prevFlagsCount == null && flagsCount > 0) {
        // Primeira análise — não dispara
        event = null;
        newFlags = [];
      }

      // 3. Novo flag crítico em fontes sancionatórias (independente do threshold)
      const newCriticalFlags = newFlags.filter(
        (f) => f?.source_id && CRITICAL_SOURCES.has(f.source_id) && f.severity === "critical",
      );
      if (newCriticalFlags.length > 0 && prevScore != null) {
        event = "new_critical_flag";
        newFlags = newCriticalFlags;
      }

      if (event && webhookUrl) {
        const payload = {
          event,
          cnpj,
          label,
          razao_social: razaoSocial,
          previous_score: prevScore,
          current_score: currentScore,
          delta,
          classification,
          subscores,
          new_flags: newFlags.map((f) => ({
            id: f.id,
            title: f.title,
            severity: f.severity,
            source: f.source,
            weight: f.weight,
          })),
          analyzed_at: new Date().toISOString(),
        };

        await fireWebhook(webhookUrl, payload);
        triggered++;
      } else if (event) {
        console.log(
          `[monitor-job] Evento ${event} para ${cnpj} (delta=${delta}, flags=${flagsCount}) — sem webhook configurado.`,
        );
      }
    } catch (error) {
      console.error(`[monitor-job] Erro ao analisar ${cnpj}:`, error?.message ?? error);
      errors++;
    }

    // Delay entre análises para não sobrecarregar as fontes externas
    await new Promise((resolve) => setTimeout(resolve, INTER_CNPJ_DELAY_MS));
  }

  console.log(
    `[monitor-job] Concluído — processed=${processed} triggered=${triggered} errors=${errors}`,
  );

  return { processed, triggered, errors };
}
