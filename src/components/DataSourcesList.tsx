import { motion } from "framer-motion";
import { Database, CheckCircle2, XCircle, AlertCircle, MinusCircle } from "lucide-react";
import type { DataSource } from "@/types/risk";

interface DataSourcesListProps {
  sources: DataSource[];
}

const statusConfig = {
  success: { icon: CheckCircle2, color: "text-risk-low", label: "Consultado" },
  not_found: { icon: CheckCircle2, color: "text-risk-low", label: "Sem registros" },
  error: { icon: XCircle, color: "text-risk-high", label: "Erro" },
  unavailable: { icon: MinusCircle, color: "text-muted-foreground", label: "Indisponível" },
  running: { icon: AlertCircle, color: "text-primary", label: "Em andamento" },
};

function reasonLabel(reason?: string) {
  const value = String(reason ?? "").trim();
  if (!value) return null;

  const map: Record<string, string> = {
    deferred_to_crawler: "DataJud não processado nesta etapa (aguardando crawler).",
    deferred_datajud_enrichment: "DataJud adiado para enriquecimento pós-crawler.",
    queued_async: "Processamento assíncrono em background.",
    match_found: "Fonte consultada com registros.",
    not_listed: "Fonte consultada sem registros.",
    partial_coverage_no_match: "Cobertura parcial; sem match confirmado.",
    entity_lookup_not_supported_public_api: "API pública sem lookup por entidade.",
    timeout_or_network: "Falha de rede/timeout.",
    no_related_companies: "Sem empresas relacionadas encontradas.",
    missing_api_key: "Chave de API não configurada.",
    unauthorized: "Acesso não autorizado na fonte.",
    rate_limited: "Fonte limitou o volume de consultas.",
    index_load_failed: "Falha ao carregar índice da fonte.",
    ok: "Consulta executada com sucesso.",
    no_tribunal_response: "Tribunal não respondeu de forma consultável.",
  };

  return map[value] ?? value;
}

export function DataSourcesList({ sources }: DataSourcesListProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.5 }}
      className="glass-card p-6"
    >
      <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
        <Database className="w-5 h-5 text-primary" />
        Bases Consultadas ({sources.length})
      </h2>
      <div className="grid gap-2">
        {sources.map((source, i) => {
          const config = statusConfig[source.status];
          const Icon = config.icon;
          const hasLatency = typeof source.latency_ms === "number" && source.latency_ms >= 0;
          const hasEvidence = typeof source.evidence_count === "number";
          const reason = reasonLabel(source.status_reason);
          return (
            <div
              key={i}
              className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-secondary/30 transition-colors"
            >
              <div className="flex items-center gap-3 min-w-0">
                <Icon className={`w-4 h-4 ${config.color} shrink-0`} />
                <div className="min-w-0">
                  <span className="text-sm truncate block">{source.name}</span>
                  {reason && <span className="text-[11px] text-muted-foreground block truncate">{reason}</span>}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {hasEvidence && (
                  <span className="text-xs text-muted-foreground hidden lg:inline">evidências: {source.evidence_count}</span>
                )}
                {hasLatency && (
                  <span className="text-xs text-muted-foreground hidden lg:inline">{source.latency_ms}ms</span>
                )}
                {source.message && (
                  <span className="text-xs text-muted-foreground hidden md:inline">{source.message}</span>
                )}
                <span className={`text-xs font-medium ${config.color}`}>{config.label}</span>
              </div>
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}
