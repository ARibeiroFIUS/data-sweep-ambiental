import { motion } from "framer-motion";
import { Users } from "lucide-react";
import type { Partner } from "@/types/risk";
import { Link } from "react-router-dom";

interface QSATableProps {
  partners: Partner[];
  companyCnpj: string;
}

function cleanDigits(value: string | undefined) {
  return String(value ?? "").replace(/\D/g, "");
}

function buildPartnerScanUrl(input: { companyCnpj: string; partnerName: string; partnerDocument?: string }) {
  const params = new URLSearchParams();
  params.set("cnpj", cleanDigits(input.companyCnpj));
  params.set("nome", String(input.partnerName ?? "").trim());

  const rawDoc = String(input.partnerDocument ?? "").trim();
  const fullCpf = cleanDigits(rawDoc);
  if (fullCpf.length === 11) {
    params.set("cpf", fullCpf);
  } else if (rawDoc) {
    params.set("cpf_hint", rawDoc);
  }

  return `/socio?${params.toString()}`;
}

export function QSATable({ partners, companyCnpj }: QSATableProps) {
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
              <th className="text-left py-3 px-3 text-xs uppercase tracking-wider text-muted-foreground font-medium">CPF/CNPJ</th>
              <th className="text-left py-3 px-3 text-xs uppercase tracking-wider text-muted-foreground font-medium">Qualificação</th>
              <th className="text-left py-3 px-3 text-xs uppercase tracking-wider text-muted-foreground font-medium">Ação</th>
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
                <td className="py-3 px-3 font-mono text-xs">{p.cnpj_cpf_do_socio || "—"}</td>
                <td className="py-3 px-3 text-muted-foreground">{p.qual}</td>
                <td className="py-3 px-3">
                  {(p.tipo ?? "PF") === "PF" ? (
                    <Link
                      to={buildPartnerScanUrl({
                        companyCnpj,
                        partnerName: p.nome ?? "",
                        partnerDocument: p.cnpj_cpf_do_socio,
                      })}
                      className="text-xs font-medium text-primary hover:underline"
                    >
                      Scan sócio
                    </Link>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </motion.div>
  );
}
