import { motion } from "framer-motion";
import { Users } from "lucide-react";
import type { Partner } from "@/types/risk";

interface QSATableProps {
  partners: Partner[];
}

export function QSATable({ partners }: QSATableProps) {
  if (!partners || partners.length === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.3 }}
      className="glass-card p-6"
    >
      <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
        <Users className="w-5 h-5 text-primary" />
        Quadro Societário (QSA)
      </h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left py-3 px-3 text-xs uppercase tracking-wider text-muted-foreground font-medium">Nome</th>
              <th className="text-left py-3 px-3 text-xs uppercase tracking-wider text-muted-foreground font-medium">Tipo</th>
              <th className="text-left py-3 px-3 text-xs uppercase tracking-wider text-muted-foreground font-medium">Qualificação</th>
            </tr>
          </thead>
          <tbody>
            {partners.map((p, i) => (
              <tr key={i} className="border-b border-border/50 hover:bg-secondary/30 transition-colors">
                <td className="py-3 px-3 font-medium">{p.nome}</td>
                <td className="py-3 px-3">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                    p.tipo === "PJ" ? "bg-primary/10 text-primary" : "bg-accent/10 text-accent"
                  }`}>
                    {p.tipo || "PF"}
                  </span>
                </td>
                <td className="py-3 px-3 text-muted-foreground">{p.qual}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </motion.div>
  );
}
