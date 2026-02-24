import { motion } from "framer-motion";
import { AlertTriangle, ShieldAlert, ShieldX, Info } from "lucide-react";
import type { RiskFlag } from "@/types/risk";

interface RiskFlagsProps {
  flags: RiskFlag[];
}

const severityConfig = {
  low: { icon: Info, color: "text-risk-low", bg: "bg-risk-low/10", border: "border-risk-low/20", label: "Baixo" },
  medium: { icon: AlertTriangle, color: "text-risk-medium", bg: "bg-risk-medium/10", border: "border-risk-medium/20", label: "Médio" },
  high: { icon: ShieldAlert, color: "text-risk-high", bg: "bg-risk-high/10", border: "border-risk-high/20", label: "Alto" },
  critical: { icon: ShieldX, color: "text-risk-critical", bg: "bg-risk-critical/10", border: "border-risk-critical/20", label: "Crítico" },
};

export function RiskFlags({ flags }: RiskFlagsProps) {
  if (flags.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
        className="glass-card p-6"
      >
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <ShieldAlert className="w-5 h-5 text-primary" />
          Flags de Risco
        </h2>
        <div className="flex items-center gap-3 p-4 rounded-lg bg-risk-low/5 border border-risk-low/20">
          <Info className="w-5 h-5 text-risk-low" />
          <p className="text-sm text-muted-foreground">Nenhum alerta encontrado nas bases consultadas.</p>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.4 }}
      className="glass-card p-6"
    >
      <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
        <ShieldAlert className="w-5 h-5 text-primary" />
        Flags de Risco ({flags.length})
      </h2>
      <div className="grid gap-3">
        {flags.map((flag, i) => {
          const config = severityConfig[flag.severity];
          const Icon = config.icon;
          return (
            <motion.div
              key={flag.id}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.4 + i * 0.1 }}
              className={`flex items-start gap-4 p-4 rounded-lg ${config.bg} border ${config.border}`}
            >
              <Icon className={`w-5 h-5 mt-0.5 ${config.color} shrink-0`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="font-semibold text-sm">{flag.title}</h3>
                  <span className={`text-xs px-2 py-0.5 rounded ${config.bg} ${config.color} font-medium`}>
                    +{flag.weight}pts
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">{flag.description}</p>
                <p className="text-xs text-muted-foreground/60 mt-1">Fonte: {flag.source}</p>
              </div>
            </motion.div>
          );
        })}
      </div>
    </motion.div>
  );
}
