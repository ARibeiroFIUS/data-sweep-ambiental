import { motion } from "framer-motion";
import { Building2, Calendar, MapPin, Hash, FileText, Landmark } from "lucide-react";
import type { CompanyData } from "@/types/risk";
import { formatCNPJ } from "@/lib/cnpj";

interface CompanyInfoGridProps {
  company: CompanyData;
}

export function CompanyInfoGrid({ company }: CompanyInfoGridProps) {
  const items = [
    { icon: Building2, label: "Razão Social", value: company.razao_social },
    { icon: Hash, label: "CNPJ", value: formatCNPJ(company.cnpj) },
    { icon: FileText, label: "Situação", value: company.situacao_cadastral },
    { icon: Calendar, label: "Abertura", value: company.data_inicio_atividade },
    { icon: Landmark, label: "CNAE", value: `${company.cnae_fiscal} — ${company.cnae_fiscal_descricao}` },
    { icon: MapPin, label: "Localização", value: `${company.municipio}/${company.uf}` },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.2 }}
      className="glass-card p-6"
    >
      <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
        <Building2 className="w-5 h-5 text-primary" />
        Informações da Empresa
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {items.map((item) => (
          <div key={item.label} className="space-y-1">
            <div className="flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wider">
              <item.icon className="w-3.5 h-3.5" />
              {item.label}
            </div>
            <p className="text-sm font-medium truncate" title={item.value}>
              {item.value || "—"}
            </p>
          </div>
        ))}
      </div>
    </motion.div>
  );
}
