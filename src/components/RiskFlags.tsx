import { useState } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, ShieldAlert, ShieldX, Info, Eye, ChevronDown, ChevronUp } from "lucide-react";
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

const confidenceLevelConfig = {
  CONFIRMADO: {
    badge: null,
    containerClass: "", // comportamento padrão — sólido
    borderStyle: "border-solid",
    opacity: "opacity-100",
  },
  PROVAVEL: {
    badge: { label: "Verificar", className: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300" },
    containerClass: "opacity-80",
    borderStyle: "border-dashed",
    opacity: "opacity-80",
  },
  POSSIVEL: {
    badge: { label: "Atenção", className: "bg-muted text-muted-foreground" },
    containerClass: "opacity-70",
    borderStyle: "border-dashed",
    opacity: "opacity-70",
  },
};

function ConfidenceBadge({ level }: { level: "CONFIRMADO" | "PROVAVEL" | "POSSIVEL" }) {
  const config = confidenceLevelConfig[level];
  if (!config.badge) return null;
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${config.badge.className}`}>
      {config.badge.label}
    </span>
  );
}

function PossibleVerificationPanel({ flag }: { flag: RiskFlag }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <Eye className="w-3 h-3" />
        {expanded ? "Ocultar detalhes" : "Ver detalhes de correspondência"}
        {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
      </button>
      {expanded && (
        <div className="mt-2 rounded border border-border/50 bg-muted/30 p-3 grid gap-1">
          <p className="text-xs font-medium text-muted-foreground mb-1">
            Correspondência por nome (CPF mascarado na Receita)
          </p>
          {flag.confidence != null && (
            <p className="text-xs text-muted-foreground">
              Score de desambiguação: <span className="font-mono">{(flag.confidence * 100).toFixed(0)}%</span>
            </p>
          )}
          {flag.evidence?.map((ev, i) => (
            <p key={i} className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground/70">{ev.label}:</span> {ev.value}
            </p>
          ))}
          <p className="text-xs text-muted-foreground/60 mt-1 italic">
            Recomendação: solicite CPF completo ao fornecedor para confirmação.
          </p>
        </div>
      )}
    </div>
  );
}

function FlagCard({ flag, index }: { flag: RiskFlag; index: number }) {
  const config = severityConfig[flag.severity];
  const Icon = config.icon;
  const confidenceLevel =
    flag.confidence_level ??
    (flag.verification_status === "possible" ? "POSSIVEL" : flag.verification_status === "probable" ? "PROVAVEL" : "CONFIRMADO");
  const confConfig = confidenceLevelConfig[confidenceLevel];

  return (
    <motion.div
      key={flag.id}
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: 0.4 + index * 0.08 }}
      className={`flex items-start gap-4 p-4 rounded-lg ${config.bg} border ${config.border} ${confConfig.borderStyle} ${confConfig.containerClass}`}
    >
      <Icon className={`w-5 h-5 mt-0.5 ${config.color} shrink-0`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <h3 className="font-semibold text-sm">{flag.title}</h3>
          <span className={`text-xs px-2 py-0.5 rounded ${config.bg} ${config.color} font-medium`}>
            +{flag.weight}pts
          </span>
          {flag.depth != null && flag.depth > 0 && (
            <span className="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground font-medium">
              Sócio depth={flag.depth}
            </span>
          )}
          {flag.confidence_level && <ConfidenceBadge level={flag.confidence_level} />}
        </div>
        <p className="text-xs text-muted-foreground">{flag.description}</p>

        {/* Evidence para flags CONFIRMADO e PROVAVEL */}
        {flag.confidence_level !== "POSSIVEL" && flag.evidence && flag.evidence.length > 0 && (
          <div className="mt-2 grid gap-1">
            {flag.evidence.map((evidenceItem, evidenceIndex) => (
              <p key={`${flag.id}-ev-${evidenceIndex}`} className="text-xs text-muted-foreground/80">
                <span className="font-medium text-foreground/80">{evidenceItem.label}:</span> {evidenceItem.value}
              </p>
            ))}
          </div>
        )}

        {/* Painel comparativo expandível para POSSIVEL */}
        {flag.confidence_level === "POSSIVEL" && (
          <PossibleVerificationPanel flag={flag} />
        )}

        {/* Evidence para POSSIVEL (fora do painel, só os primeiros) */}
        {flag.confidence_level === "PROVAVEL" && flag.confidence != null && (
          <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
            Correspondência por nome — confiança: {(flag.confidence * 100).toFixed(0)}%. Recomenda-se verificação manual.
          </p>
        )}

        <p className="text-xs text-muted-foreground/60 mt-1">Fonte: {flag.source}</p>
      </div>
    </motion.div>
  );
}

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

  const statusOf = (flag: RiskFlag) => {
    if (flag.verification_status) return flag.verification_status;
    if (flag.confidence_level === "PROVAVEL") return "probable";
    if (flag.confidence_level === "POSSIVEL") return "possible";
    return "objective";
  };

  const confirmed = flags.filter((f) => statusOf(f) === "objective");
  const probable = flags.filter((f) => statusOf(f) === "probable");
  const possible = flags.filter((f) => statusOf(f) === "possible");

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
        {probable.length > 0 && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300 ml-1">
            {probable.length} a verificar
          </span>
        )}
      </h2>

      <div className="grid gap-3">
        {confirmed.map((flag, i) => (
          <FlagCard key={flag.id} flag={flag} index={i} />
        ))}
        {probable.map((flag, i) => (
          <FlagCard key={flag.id} flag={flag} index={confirmed.length + i} />
        ))}
        {possible.map((flag, i) => (
          <FlagCard key={flag.id} flag={flag} index={confirmed.length + probable.length + i} />
        ))}
      </div>
    </motion.div>
  );
}
