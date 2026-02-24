import { motion } from "framer-motion";
import { CheckCircle, Loader2 } from "lucide-react";

interface LoadingOverlayProps {
  sources: string[];
  currentIndex: number;
}

const ALL_SOURCES = [
  "Receita Federal (BrasilAPI)",
  "CEIS — Empresas Inidôneas e Suspensas",
  "CNEP — Empresas Punidas",
  "CEPIM — Entidades Impedidas",
  "TCU — Licitantes Inidôneos",
  "MTE — Lista de Trabalho Escravo",
  "PGFN — Dívida Ativa",
  "Servidores Federais (CGU)",
];

export function LoadingOverlay() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="w-full max-w-lg mx-auto mt-12"
    >
      <div className="glass-card p-8 space-y-6">
        <div className="flex items-center gap-3 mb-2">
          <Loader2 className="w-6 h-6 text-primary animate-spin" />
          <h3 className="text-lg font-semibold">Consultando bases de dados...</h3>
        </div>
        <div className="space-y-3">
          {ALL_SOURCES.map((source, i) => (
            <motion.div
              key={source}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.15 }}
              className="flex items-center gap-3 text-sm"
            >
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 1, repeat: Infinity, ease: "linear", delay: i * 0.15 }}
              >
                <Loader2 className="w-4 h-4 text-primary" />
              </motion.div>
              <span className="text-muted-foreground">{source}</span>
            </motion.div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}
