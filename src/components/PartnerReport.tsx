import { motion } from "framer-motion";
import { ArrowLeft, Shield, Network } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScoreCircle } from "@/components/ScoreCircle";
import { RiskFlags } from "@/components/RiskFlags";
import { DataSourcesList } from "@/components/DataSourcesList";
import type { PartnerRiskAnalysis } from "@/types/risk";

interface PartnerReportProps {
  data: PartnerRiskAnalysis;
  onBack: () => void;
}

const classificationColors: Record<string, string> = {
  Baixo: "bg-risk-low/10 text-risk-low border-risk-low/20",
  Médio: "bg-risk-medium/10 text-risk-medium border-risk-medium/20",
  Alto: "bg-risk-high/10 text-risk-high border-risk-high/20",
  Crítico: "bg-risk-critical/10 text-risk-critical border-risk-critical/20",
};

export function PartnerReport({ data, onBack }: PartnerReportProps) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="w-full max-w-5xl mx-auto space-y-6"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={onBack} className="shrink-0">
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="text-2xl md:text-3xl font-bold">{data.person.nome}</h1>
            <p className="text-muted-foreground text-sm">
              CPF: {data.person.cpf} | Empresa: {data.company_context.razao_social} ({data.company_context.cnpj})
            </p>
          </div>
        </div>
        <span
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border ${classificationColors[data.classification]}`}
        >
          <Shield className="w-3.5 h-3.5" />
          Risco {data.classification}
        </span>
      </div>

      <div className="glass-card p-6 flex flex-col md:flex-row items-center gap-6">
        <ScoreCircle score={data.score} classification={data.classification} />
        <div className="flex-1 text-center md:text-left">
          <h3 className="font-semibold mb-2">Resumo da Análise Individual</h3>
          <p className="text-sm text-muted-foreground leading-relaxed">{data.summary}</p>
          <p className="text-xs text-muted-foreground/50 mt-3">
            Análise realizada em {new Date(data.analyzed_at).toLocaleString("pt-BR")}
          </p>
          {data.meta?.partner_search_id && (
            <p className="text-xs text-muted-foreground/50 mt-1">
              ID da busca de sócio: {data.meta.partner_search_id}
            </p>
          )}
          <p className="text-xs text-muted-foreground/50 mt-1">
            Validação de vínculo: {data.person.company_link_validation.mode}
          </p>
        </div>
      </div>

      <div className="glass-card p-6">
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Network className="w-5 h-5 text-primary" />
          Empresas Relacionadas ({data.related_entities.reverse_lookup.total_companies})
        </h2>
        {data.related_entities.reverse_lookup.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma empresa adicional relacionada encontrada.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/50 text-left text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">CNPJ</th>
                  <th className="py-2 pr-3 font-medium">Razão Social</th>
                  <th className="py-2 pr-3 font-medium">UF</th>
                  <th className="py-2 pr-3 font-medium">Município</th>
                  <th className="py-2 pr-0 font-medium">Provedores</th>
                </tr>
              </thead>
              <tbody>
                {data.related_entities.reverse_lookup.items.map((item) => (
                  <tr key={item.cnpj} className="border-b border-border/30">
                    <td className="py-2 pr-3 font-mono text-xs">{item.cnpj}</td>
                    <td className="py-2 pr-3">{item.razao_social || "—"}</td>
                    <td className="py-2 pr-3">{item.uf || "—"}</td>
                    <td className="py-2 pr-3">{item.municipio || "—"}</td>
                    <td className="py-2 pr-0">{item.providers.join(" + ") || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <RiskFlags flags={data.flags} />
      <DataSourcesList sources={data.sources} />
    </motion.div>
  );
}
