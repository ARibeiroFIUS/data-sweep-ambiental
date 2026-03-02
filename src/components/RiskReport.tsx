import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Shield, ArrowLeft, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScoreCircle } from "@/components/ScoreCircle";
import { CompanyInfoGrid } from "@/components/CompanyInfoGrid";
import { QSATable } from "@/components/QSATable";
import { RiskFlags } from "@/components/RiskFlags";
import { DataSourcesList } from "@/components/DataSourcesList";
import { AiAnalysisSection } from "@/components/AiAnalysisSection";
import { EntityGraphSection } from "@/components/EntityGraphSection";
import { DatajudSection } from "@/components/DatajudSection";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type {
  InvestigationEventsResponse,
  InvestigationGraphResponse,
  InvestigationJudicialCoverageResponse,
  InvestigationJudicialProcessesResponse,
  InvestigationJudicialSummary,
  InvestigationStatus,
  RiskAnalysis,
  PartnerCompanyItem,
} from "@/types/risk";

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

const riskBadgeColors: Record<string, string> = {
  Baixo: "bg-risk-low/10 text-risk-low",
  Médio: "bg-risk-medium/10 text-risk-medium",
  Alto: "bg-risk-high/10 text-risk-high",
  Crítico: "bg-risk-critical/10 text-risk-critical",
};

const subscoreLabels: Record<string, string> = {
  score_integridade: "Integridade",
  score_judicial: "Judicial",
  score_trabalhista: "Trabalhista/ESG",
  score_financeiro: "Financeiro",
  score_rede: "Rede societária",
};

const API_BASE_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ?? "";
const INVESTIGATION_API_BASE = API_BASE_URL ? `${API_BASE_URL}/api/investigations` : "/api/investigations";

async function fetchInvestigationStatus(runId: string): Promise<InvestigationStatus | null> {
  const response = await fetch(`${INVESTIGATION_API_BASE}/${encodeURIComponent(runId)}`);
  if (!response.ok) return null;
  const payload = (await response.json().catch(() => null)) as InvestigationStatus | null;
  return payload;
}

async function fetchInvestigationGraph(runId: string): Promise<InvestigationGraphResponse | null> {
  const response = await fetch(`${INVESTIGATION_API_BASE}/${encodeURIComponent(runId)}/graph`);
  if (!response.ok) return null;
  const payload = (await response.json().catch(() => null)) as InvestigationGraphResponse | null;
  return payload;
}

async function fetchInvestigationEvents(runId: string, cursor: number): Promise<InvestigationEventsResponse | null> {
  const response = await fetch(`${INVESTIGATION_API_BASE}/${encodeURIComponent(runId)}/events?cursor=${cursor}`);
  if (!response.ok) return null;
  const payload = (await response.json().catch(() => null)) as InvestigationEventsResponse | null;
  return payload;
}

async function fetchJudicialCoverage(runId: string): Promise<InvestigationJudicialCoverageResponse | null> {
  const response = await fetch(
    `${INVESTIGATION_API_BASE}/${encodeURIComponent(runId)}/judicial/coverage`,
  );
  if (!response.ok) return null;
  const payload = (await response.json().catch(() => null)) as InvestigationJudicialCoverageResponse | null;
  return payload;
}

async function fetchJudicialProcesses(runId: string): Promise<InvestigationJudicialProcessesResponse | null> {
  const response = await fetch(
    `${INVESTIGATION_API_BASE}/${encodeURIComponent(runId)}/judicial/processes`,
  );
  if (!response.ok) return null;
  const payload = (await response.json().catch(() => null)) as InvestigationJudicialProcessesResponse | null;
  return payload;
}

async function fetchJudicialSummary(runId: string): Promise<InvestigationJudicialSummary | null> {
  const response = await fetch(
    `${INVESTIGATION_API_BASE}/${encodeURIComponent(runId)}/judicial/summary`,
  );
  if (!response.ok) return null;
  const payload = (await response.json().catch(() => null)) as InvestigationJudicialSummary | null;
  return payload;
}

function PartnerRiskRow({ item }: { item: PartnerCompanyItem }) {
  const [expanded, setExpanded] = useState(false);
  const hasRisk = item.risk_flags && item.risk_flags.length > 0;

  return (
    <>
      <tr className="border-b border-border/40 hover:bg-muted/20 transition-colors">
        <td className="py-2 pr-3">{item.partner_name}</td>
        <td className="py-2 pr-3 font-mono text-xs">{item.cnpj}</td>
        <td className="py-2 pr-3">{item.razao_social}</td>
        <td className="py-2 pr-3">{item.situacao_cadastral || "—"}</td>
        <td className="py-2 pr-3">{item.uf || "—"}</td>
        <td className="py-2 pr-3">
          {item.risk_classification ? (
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${riskBadgeColors[item.risk_classification] ?? ""}`}>
              {item.risk_score != null && item.risk_score > 0 && (
                <span className="font-mono">{item.risk_score}</span>
              )}
              {item.risk_classification}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </td>
        {hasRisk && (
          <td className="py-2">
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              {item.risk_flags!.length} flag{item.risk_flags!.length !== 1 ? "s" : ""}
            </button>
          </td>
        )}
        {!hasRisk && <td className="py-2" />}
      </tr>
      {expanded && hasRisk && (
        <tr className="border-b border-border/40 bg-muted/10">
          <td colSpan={7} className="py-2 px-3">
            <div className="grid gap-1">
              {item.risk_flags!.map((flag) => (
                <div key={flag.id} className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className={`px-1.5 py-0.5 rounded font-medium ${riskBadgeColors[flag.severity] ?? "bg-muted text-muted-foreground"}`}>
                    {flag.severity?.toUpperCase()}
                  </span>
                  <span>{flag.title}</span>
                  <span className="text-muted-foreground/60">+{flag.weight}pts</span>
                </div>
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export function RiskReport({ data, onBack }: RiskReportProps) {
  const partnerCompanies = data.related_entities?.partner_companies;
  const pfReverse = data.related_entities?.pf_reverse_lookup;
  const deepRunId = data.meta?.deep_investigation?.run_id ?? data.related_entities?.graph?.run_id ?? null;
  const searchId = data.meta?.search_id ?? null;
  const datajudSource = data.sources.find((source) => source.id === "datajud");

  const [investigationStatus, setInvestigationStatus] = useState<InvestigationStatus | null>(null);
  const [investigationGraph, setInvestigationGraph] = useState<InvestigationGraphResponse | null>(null);
  const [investigationEvents, setInvestigationEvents] = useState<InvestigationEventsResponse["events"]>([]);
  const [eventsCursor, setEventsCursor] = useState(0);
  const [graphLoading, setGraphLoading] = useState(false);
  const [judicialCoverage, setJudicialCoverage] = useState<InvestigationJudicialCoverageResponse | null>(null);
  const [judicialProcesses, setJudicialProcesses] = useState<InvestigationJudicialProcessesResponse | null>(null);
  const [judicialSummary, setJudicialSummary] = useState<InvestigationJudicialSummary | null>(null);

  useEffect(() => {
    if (!deepRunId) return;
    let cancelled = false;
    let cursor = 0;
    setInvestigationStatus(null);
    setInvestigationGraph(null);
    setInvestigationEvents([]);
    setEventsCursor(0);
    setJudicialCoverage(null);
    setJudicialProcesses(null);
    setJudicialSummary(null);

    const poll = async () => {
      if (cancelled) return;
      setGraphLoading(true);

      const [status, graph, events, coverage, processes, summary] = await Promise.all([
        fetchInvestigationStatus(deepRunId),
        fetchInvestigationGraph(deepRunId),
        fetchInvestigationEvents(deepRunId, cursor),
        fetchJudicialCoverage(deepRunId),
        fetchJudicialProcesses(deepRunId),
        fetchJudicialSummary(deepRunId),
      ]);

      if (cancelled) return;
      if (status) setInvestigationStatus(status);
      if (graph) setInvestigationGraph(graph);
      if (events) {
        cursor = events.cursor;
        setEventsCursor(events.cursor);
        setInvestigationEvents((prev) => {
          const merged = [...prev, ...events.events];
          const deduped = new Map(merged.map((event) => [event.seq, event]));
          return Array.from(deduped.values()).sort((a, b) => a.seq - b.seq).slice(-500);
        });
      }
      if (coverage) setJudicialCoverage(coverage);
      if (processes) setJudicialProcesses(processes);
      if (summary) setJudicialSummary(summary);

      setGraphLoading(false);
    };

    poll();
    const interval = setInterval(poll, 5000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [deepRunId]);

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

      {/* AI Analysis — posição de destaque, acima dos dados */}
      <AiAnalysisSection aiAnalysis={data.ai_analysis} />

      {/* Score + Summary */}
      <div className="glass-card p-6 flex flex-col md:flex-row items-center gap-6">
        <ScoreCircle score={data.score} classification={data.classification} />
        <div className="flex-1 text-center md:text-left">
          <h3 className="font-semibold mb-2">Resumo da Análise</h3>
          <p className="text-sm text-muted-foreground leading-relaxed">{data.summary}</p>
          <p className="text-xs text-muted-foreground/50 mt-3">
            Análise realizada em {new Date(data.analyzed_at).toLocaleString("pt-BR")}
          </p>
          {searchId && <p className="text-xs text-muted-foreground/50 mt-1">ID da busca: {searchId}</p>}
          {data.meta && (
            <p className="text-xs text-muted-foreground/50 mt-1">
              {data.meta.partial ? "Resultado parcial (uma ou mais fontes indisponíveis)." : "Resultado completo."}
            </p>
          )}
          {deepRunId && (
            <p className="text-xs text-muted-foreground/50 mt-1">
              Investigação profunda: {investigationStatus?.status ?? data.meta?.deep_investigation?.status ?? "queued"}{" "}
              {eventsCursor > 0 ? `| eventos: ${eventsCursor}` : ""}
            </p>
          )}
          {data.meta?.judicial_scan && (
            <p className="text-xs text-muted-foreground/50 mt-1">
              Crawler judicial: {judicialSummary?.consulted ?? data.meta.judicial_scan.consulted}/{judicialSummary?.supported ?? data.meta.judicial_scan.supported} tribunais
              {" "}| processos: {judicialSummary?.found_processes ?? data.meta.judicial_scan.found_processes}
            </p>
          )}
          {data.meta?.crawler_coverage_summary && (
            <p className="text-xs text-muted-foreground/50 mt-1">
              Cobertura efetiva do crawler: {data.meta.crawler_coverage_summary.coverage_percent.toFixed(1)}%
              {" "}({data.meta.crawler_coverage_summary.success + data.meta.crawler_coverage_summary.not_found}/
              {data.meta.crawler_coverage_summary.eligible})
            </p>
          )}
          {datajudSource && (
            <p className="text-xs text-muted-foreground/50 mt-1">
              DataJud:{" "}
              {datajudSource.status_reason === "deferred_to_crawler"
                ? "não processado na busca inicial; só após processos encontrados no crawler"
                : datajudSource.status === "running"
                  ? "processando em background"
                  : datajudSource.status === "error" || datajudSource.status === "unavailable"
                    ? "processado com falha/indisponibilidade"
                    : "processado"}
            </p>
          )}
        </div>
      </div>

      {(data.subscores || data.score_explanation?.top_risks?.length || data.score_explanation?.mitigators?.length || data.meta?.score_trend || data.meta?.peer_benchmark || data.meta?.crawler_coverage_summary) && (
        <div className="glass-card p-6 space-y-5">
          <h2 className="text-lg font-semibold">Painel Analítico</h2>

          {data.subscores && (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {Object.entries(data.subscores).map(([key, dim]) => (
                <div key={key} className="rounded-lg border border-border/60 p-3 bg-secondary/20">
                  <p className="text-xs text-muted-foreground">{subscoreLabels[key] ?? key}</p>
                  <p className="text-lg font-semibold mt-1">{dim.score}</p>
                  <p className="text-xs mt-1">
                    <span className={`inline-flex items-center px-1.5 py-0.5 rounded ${riskBadgeColors[dim.classification] ?? "bg-muted text-muted-foreground"}`}>
                      {dim.classification}
                    </span>
                    <span className="text-muted-foreground ml-2">{dim.flag_count} flag(s)</span>
                  </p>
                </div>
              ))}
            </div>
          )}

          {data.score_explanation?.top_risks?.length ? (
            <div className="space-y-2">
              <h3 className="text-sm font-medium">Top fatores que mais pesaram no score</h3>
              <div className="space-y-1">
                {data.score_explanation.top_risks.map((item) => (
                  <p key={`${item.id}-${item.title}`} className="text-sm text-muted-foreground">
                    <span className="text-foreground font-medium">{item.title}</span>{" "}
                    <span className="text-xs">(+{item.effective_weight} pts)</span>
                  </p>
                ))}
              </div>
            </div>
          ) : null}

          {data.score_explanation?.mitigators?.length ? (
            <div className="space-y-2">
              <h3 className="text-sm font-medium">Fatores mitigadores (reduziram impacto)</h3>
              <div className="space-y-1">
                {data.score_explanation.mitigators.map((item) => (
                  <p key={`${item.id}-${item.title}-mit`} className="text-sm text-muted-foreground">
                    <span className="text-foreground font-medium">{item.title}</span>{" "}
                    <span className="text-xs">(-{item.reduction} pts)</span>
                    {item.reason ? <span className="text-xs"> · {item.reason}</span> : null}
                  </p>
                ))}
              </div>
            </div>
          ) : null}

          {data.meta?.crawler_coverage_summary ? (
            <div className="rounded-lg border border-border/60 p-3 bg-secondary/20">
              <p className="text-sm text-muted-foreground">
                Cobertura judicial efetiva:{" "}
                <span className="font-semibold text-foreground">
                  {data.meta.crawler_coverage_summary.coverage_percent.toFixed(1)}%
                </span>{" "}
                ({data.meta.crawler_coverage_summary.success + data.meta.crawler_coverage_summary.not_found}/
                {data.meta.crawler_coverage_summary.eligible}) · indisponíveis:{" "}
                <span className="font-medium text-foreground">{data.meta.crawler_coverage_summary.unavailable}</span>
              </p>
            </div>
          ) : null}

          {data.meta?.score_trend?.points && data.meta.score_trend.points.length > 1 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-medium">Tendência de score</h3>
                <p className="text-xs text-muted-foreground">
                  30d: {data.meta.score_trend.delta_30d >= 0 ? "+" : ""}
                  {data.meta.score_trend.delta_30d} | 90d: {data.meta.score_trend.delta_90d >= 0 ? "+" : ""}
                  {data.meta.score_trend.delta_90d} | {data.meta.score_trend.trend}
                </p>
              </div>
              <div className="h-44 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={data.meta.score_trend.points.map((p) => ({
                      score: p.score,
                      label: new Date(p.analyzed_at).toLocaleDateString("pt-BR"),
                    }))}
                    margin={{ top: 8, right: 8, left: -20, bottom: 0 }}
                  >
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Line type="monotone" dataKey="score" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 2 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {data.meta?.peer_benchmark && (
            <div className="rounded-lg border border-border/60 p-3 bg-secondary/20">
              <p className="text-sm text-muted-foreground">
                Benchmark CNAE <span className="font-medium text-foreground">{data.meta.peer_benchmark.cnae}</span>: top{" "}
                <span className="font-semibold text-foreground">{data.meta.peer_benchmark.top_risk_percent}%</span> de risco em{" "}
                <span className="font-semibold text-foreground">{data.meta.peer_benchmark.sample_size}</span> empresa(s) do segmento.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Company Info */}
      <CompanyInfoGrid company={data.company} />

      {/* QSA */}
      <QSATable partners={data.company.qsa} companyCnpj={data.company.cnpj} />

      {(partnerCompanies || pfReverse) && (
        <div className="glass-card p-6 space-y-4">
          <h2 className="text-lg font-semibold">Conexões Societárias</h2>

          {partnerCompanies && (
            <div className="space-y-2">
              <h3 className="text-sm font-medium">Sócios PJ (QSA) — detalhes e risco</h3>
              {partnerCompanies.message && <p className="text-xs text-muted-foreground">{partnerCompanies.message}</p>}
              {partnerCompanies.items.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhuma empresa relacionada disponível nesta fonte.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-muted-foreground border-b border-border">
                        <th className="py-2 pr-3">Sócio no QSA</th>
                        <th className="py-2 pr-3">CNPJ</th>
                        <th className="py-2 pr-3">Razão Social</th>
                        <th className="py-2 pr-3">Situação</th>
                        <th className="py-2 pr-3">UF</th>
                        <th className="py-2 pr-3">Risco</th>
                        <th className="py-2 pr-3"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {partnerCompanies.items.map((item) => (
                        <PartnerRiskRow key={`${item.partner_name}-${item.cnpj}`} item={item} />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {pfReverse && (
            <div className="rounded-lg border border-border/60 bg-secondary/20 p-3">
              <h3 className="text-sm font-medium mb-1">Sócios PF e outras empresas</h3>
              <p className="text-xs text-muted-foreground">
                Status: {pfReverse.status === "running" ? "em processamento assíncrono" : pfReverse.status}
                {pfReverse.run_id ? ` (run_id: ${pfReverse.run_id})` : ""}
              </p>
              <p className="text-xs text-muted-foreground">{pfReverse.message}</p>
              <p className="text-xs text-muted-foreground mt-1">
                Sócios PF no QSA: {pfReverse.checked_pf_partners} | CPF completo: {pfReverse.cpf_full_count} | CPF mascarado:{" "}
                {pfReverse.cpf_masked_count}
              </p>
            </div>
          )}
        </div>
      )}

      {deepRunId && (
        <EntityGraphSection
          runId={deepRunId}
          status={investigationStatus}
          graph={investigationGraph}
          events={investigationEvents}
          loading={graphLoading}
        />
      )}

      {/* Judicial Processes */}
      <DatajudSection
        processes={data.judicial_processes}
        judicialCoverage={judicialCoverage}
        judicialProcesses={judicialProcesses}
        judicialSummary={judicialSummary ?? investigationStatus?.judicial_scan ?? data.meta?.judicial_scan ?? null}
      />

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
