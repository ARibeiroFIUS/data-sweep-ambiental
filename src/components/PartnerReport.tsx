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

function validationModeLabel(mode: string | undefined) {
  if (mode === "cpf_exact") return "CPF exato no QSA";
  if (mode === "name_and_mask") return "Nome + CPF mascarado no QSA";
  if (mode === "name_unique") return "Nome único no QSA";
  return mode ?? "desconhecido";
}

export function PartnerReport({ data, onBack }: PartnerReportProps) {
  const objectiveFlags = data.flags.filter(
    (flag) => (flag.verification_status ?? "objective") === "objective",
  ).length;
  const probableFlags = data.flags.filter(
    (flag) =>
      (flag.verification_status ?? (flag.confidence_level === "PROVAVEL" ? "probable" : "objective")) ===
      "probable",
  ).length;
  const possibleFlags = data.flags.filter(
    (flag) =>
      (flag.verification_status ?? (flag.confidence_level === "POSSIVEL" ? "possible" : "objective")) ===
      "possible",
  ).length;

  const sourcesConsulted = data.sources.filter((source) => source.status === "success" || source.status === "not_found").length;
  const sourcesUnavailable = data.sources.filter((source) => source.status === "unavailable" || source.status === "error").length;
  const reverseSummary = data.related_entities.reverse_lookup.summary;
  const contextRoot = reverseSummary?.context_root ?? data.company_context.cnpj.slice(0, 8);

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
            Validação de vínculo: {validationModeLabel(data.person.company_link_validation.mode)}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="glass-card p-3">
          <p className="text-[11px] text-muted-foreground uppercase tracking-wider">Cobertura de Fontes</p>
          <p className="text-lg font-semibold">
            {sourcesConsulted}/{data.sources.length}
          </p>
          <p className="text-xs text-muted-foreground">{sourcesUnavailable} indisponível(is)</p>
        </div>
        <div className="glass-card p-3">
          <p className="text-[11px] text-muted-foreground uppercase tracking-wider">Flags Objetivas</p>
          <p className="text-lg font-semibold">{objectiveFlags}</p>
          <p className="text-xs text-muted-foreground">confirmadas por dado objetivo</p>
        </div>
        <div className="glass-card p-3">
          <p className="text-[11px] text-muted-foreground uppercase tracking-wider">Flags Prováveis</p>
          <p className="text-lg font-semibold">{probableFlags}</p>
          <p className="text-xs text-muted-foreground">requerem validação adicional</p>
        </div>
        <div className="glass-card p-3">
          <p className="text-[11px] text-muted-foreground uppercase tracking-wider">Raízes de CNPJ</p>
          <p className="text-lg font-semibold">{reverseSummary?.distinct_roots ?? 0}</p>
          <p className="text-xs text-muted-foreground">nas empresas relacionadas</p>
        </div>
      </div>

      <div className="glass-card p-6">
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Network className="w-5 h-5 text-primary" />
          Empresas Relacionadas ({data.related_entities.reverse_lookup.total_companies})
        </h2>
        {reverseSummary && reverseSummary.same_context_root_companies >= 2 && reverseSummary.different_root_companies === 0 && (
          <div className="mb-4 rounded border border-border/60 bg-secondary/20 p-3">
            <p className="text-sm text-muted-foreground">
              As relações encontradas estão concentradas na mesma raiz de CNPJ da empresa analisada ({contextRoot}),
              indicando principalmente matriz/filiais.
            </p>
          </div>
        )}
        {data.related_entities.reverse_lookup.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma empresa adicional relacionada encontrada.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/50 text-left text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">CNPJ</th>
                  <th className="py-2 pr-3 font-medium">Raiz</th>
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
                    <td className="py-2 pr-3 font-mono text-xs">
                      {item.cnpj.slice(0, 8)}
                      {item.cnpj.slice(0, 8) === contextRoot ? " (mesma raiz)" : ""}
                    </td>
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
      {possibleFlags > 0 && (
        <div className="rounded border border-border/60 bg-secondary/20 p-3">
          <p className="text-xs text-muted-foreground">
            {possibleFlags} flag(s) estão com nível "possible" e não impactam score automaticamente.
          </p>
        </div>
      )}
      <DataSourcesList sources={data.sources} />
    </motion.div>
  );
}
