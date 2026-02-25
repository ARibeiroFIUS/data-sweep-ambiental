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
};

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
          return (
            <div
              key={i}
              className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-secondary/30 transition-colors"
            >
              <div className="flex items-center gap-3 min-w-0">
                <Icon className={`w-4 h-4 ${config.color} shrink-0`} />
                <span className="text-sm truncate">{source.name}</span>
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
