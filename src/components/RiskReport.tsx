import { motion } from "framer-motion";
import { Shield, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScoreCircle } from "@/components/ScoreCircle";
import { CompanyInfoGrid } from "@/components/CompanyInfoGrid";
import { QSATable } from "@/components/QSATable";
import { RiskFlags } from "@/components/RiskFlags";
import { DataSourcesList } from "@/components/DataSourcesList";
import type { RiskAnalysis } from "@/types/risk";

interface RiskReportProps {
  data: RiskAnalysis;
  onBack: () => void;
}

const classificationColors: Record<string, string> = {
  Baixo: "bg-risk-low/10 text-risk-low border-risk-low/20",
  Médio: "bg-risk-medium/10 text-risk-medium border-risk-medium/20",
  Alto: "bg-risk-high/10 text-risk-high border-risk-high/20",
  Crítico: "bg-risk-critical/10 text-risk-critical border-risk-critical/20",
};

export function RiskReport({ data, onBack }: RiskReportProps) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="w-full max-w-5xl mx-auto space-y-6"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={onBack} className="shrink-0">
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="text-2xl md:text-3xl font-bold">{data.company.razao_social}</h1>
            {data.company.nome_fantasia && (
              <p className="text-muted-foreground text-sm">{data.company.nome_fantasia}</p>
            )}
          </div>
        </div>
        <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border ${classificationColors[data.classification]}`}>
          <Shield className="w-3.5 h-3.5" />
          Risco {data.classification}
        </span>
      </div>

      {/* Score + Summary */}
      <div className="glass-card p-6 flex flex-col md:flex-row items-center gap-6">
        <ScoreCircle score={data.score} classification={data.classification} />
        <div className="flex-1 text-center md:text-left">
          <h3 className="font-semibold mb-2">Resumo da Análise</h3>
          <p className="text-sm text-muted-foreground leading-relaxed">{data.summary}</p>
          <p className="text-xs text-muted-foreground/50 mt-3">
            Análise realizada em {new Date(data.analyzed_at).toLocaleString("pt-BR")}
          </p>
          {data.meta && (
            <p className="text-xs text-muted-foreground/50 mt-1">
              {data.meta.partial ? "Resultado parcial (uma ou mais fontes indisponíveis)." : "Resultado completo."}
            </p>
          )}
        </div>
      </div>

      {/* Company Info */}
      <CompanyInfoGrid company={data.company} />

      {/* QSA */}
      <QSATable partners={data.company.qsa} />

      {/* Risk Flags */}
      <RiskFlags flags={data.flags} />

      {/* Data Sources */}
      <DataSourcesList sources={data.sources} />

      {/* Disclaimer */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.6 }}
        className="text-center py-6 border-t border-border"
      >
        <p className="text-xs text-muted-foreground/50 max-w-2xl mx-auto leading-relaxed">
          <strong>Disclaimer:</strong> Este relatório é gerado automaticamente com base em dados públicos disponíveis
          no momento da consulta. Não constitui parecer jurídico ou garantia de idoneidade. Recomenda-se validação
          independente antes de qualquer decisão comercial.
        </p>
      </motion.div>
    </motion.div>
  );
}
