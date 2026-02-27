import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  Building2,
  Calendar,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Scale,
  Search,
  ShieldAlert,
} from "lucide-react";
import type {
  InvestigationJudicialCoverageResponse,
  InvestigationJudicialProcess,
  InvestigationJudicialProcessesResponse,
  InvestigationJudicialSummary,
  JudicialProcess,
  JudicialScanMeta,
} from "@/types/risk";

interface DatajudSectionProps {
  processes?: JudicialProcess[];
  judicialCoverage?: InvestigationJudicialCoverageResponse | null;
  judicialProcesses?: InvestigationJudicialProcessesResponse | null;
  judicialSummary?: InvestigationJudicialSummary | JudicialScanMeta | null;
}

interface DisplayProcess {
  tribunalId: string;
  tribunalName: string;
  numeroProcesso: string;
  classeNome: string | null;
  assuntos: string[];
  dataAjuizamento: string | null;
  ano: string | null;
  orgaoJulgadorNome: string | null;
  valor: number | null;
  grau: string | null;
  polo: "ATIVO" | "PASSIVO" | "INDEFINIDO" | null;
  parteContraria: string[];
  andamentos: Array<{ dataHora: string | null; nome: string; complemento: string | null }>;
  sourceUrl?: string | null;
}

const TYPE_CONFIG = {
  criminal: {
    label: "Processos Criminais / Improbidade",
    color: "text-risk-critical",
    bg: "bg-risk-critical/10 border-risk-critical/30",
  },
  fiscal: {
    label: "Execuções Fiscais",
    color: "text-risk-high",
    bg: "bg-risk-high/10 border-risk-high/30",
  },
  trabalhista: {
    label: "Processos Trabalhistas",
    color: "text-risk-medium",
    bg: "bg-risk-medium/10 border-risk-medium/30",
  },
  civil: {
    label: "Processos Cíveis",
    color: "text-risk-low",
    bg: "bg-risk-low/10 border-risk-low/30",
  },
  outro: {
    label: "Outros Processos",
    color: "text-muted-foreground",
    bg: "bg-muted/20 border-border/40",
  },
} as const;

type ProcessType = keyof typeof TYPE_CONFIG;

function formatBRL(value: number | null): string | null {
  if (value == null) return null;
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  try {
    return new Date(dateStr).toLocaleDateString("pt-BR");
  } catch {
    return dateStr;
  }
}

function classifyProcess(p: DisplayProcess): ProcessType {
  const text = [p.classeNome ?? "", ...p.assuntos, p.tribunalName ?? "", p.tribunalId ?? ""].join(" ");

  if (/criminal|penal|improbidade|fraude|corrupção|estelionato|lavagem/i.test(text)) return "criminal";
  if (/execução fiscal|dívida ativa|fazenda|tributária|tributário/i.test(text)) return "fiscal";
  if (/trabalhista|reclamação|rescisão|trabalho|empregado|fgts|verbas/i.test(text) || /^trt/i.test(p.tribunalId)) {
    return "trabalhista";
  }
  if (/indenização|cobrança|monitória|despejo|contrato|civil/i.test(text)) return "civil";
  return "outro";
}

function normalizeProcesses(
  judicialProcesses: InvestigationJudicialProcessesResponse | null | undefined,
  legacyProcesses: JudicialProcess[] | undefined,
): DisplayProcess[] {
  const fromInvestigation: DisplayProcess[] = (judicialProcesses?.items ?? []).map((item: InvestigationJudicialProcess) => ({
    tribunalId: item.tribunal_id,
    tribunalName: item.tribunal_name || item.tribunal_id,
    numeroProcesso: item.numero_processo,
    classeNome: item.classe ?? null,
    assuntos: item.assunto ? String(item.assunto).split(";").map((v) => v.trim()).filter(Boolean) : [],
    dataAjuizamento: item.data_ajuizamento ?? null,
    ano: item.data_ajuizamento ? String(item.data_ajuizamento).slice(0, 4) : null,
    orgaoJulgadorNome: item.orgao_julgador ?? null,
    valor: item.valor_causa ?? null,
    grau: null,
    polo:
      String(item.polo_empresa ?? "").toUpperCase() === "ATIVO"
        ? "ATIVO"
        : String(item.polo_empresa ?? "").toUpperCase() === "PASSIVO"
          ? "PASSIVO"
          : null,
    parteContraria: Array.isArray(item.parte_contraria) ? item.parte_contraria : [],
    andamentos: Array.isArray(item.andamentos)
      ? item.andamentos.map((a) => ({
          dataHora: a?.dataHora ?? null,
          nome: String(a?.nome ?? ""),
          complemento: a?.complemento ?? null,
        }))
      : [],
    sourceUrl: item.source_url ?? null,
  }));

  if (fromInvestigation.length > 0) return fromInvestigation;

  return (legacyProcesses ?? []).map((p) => ({
    tribunalId: p.tribunal,
    tribunalName: p.tribunal,
    numeroProcesso: p.numeroProcesso,
    classeNome: p.classe?.nome ?? null,
    assuntos: (p.assuntos ?? []).map((a) => a?.nome ?? "").filter(Boolean),
    dataAjuizamento: p.dataAjuizamento,
    ano: p.ano,
    orgaoJulgadorNome: p.orgaoJulgador?.nome ?? null,
    valor: p.valor,
    grau: p.grau,
    polo: p.polo ?? null,
    parteContraria: p.parteContraria ?? [],
    andamentos: (p.andamentos ?? []).map((a) => ({
      dataHora: a.dataHora,
      nome: a.nome,
      complemento: a.complemento,
    })),
    sourceUrl: p.sourceUrl ?? null,
  }));
}

function poloUi(polo: DisplayProcess["polo"]) {
  if (polo === "ATIVO") {
    return { label: "Autora/Credora", className: "bg-blue-500/10 text-blue-400" };
  }
  if (polo === "PASSIVO") {
    return { label: "Ré/Executada", className: "bg-orange-500/10 text-orange-400" };
  }
  return { label: "Polo indefinido", className: "bg-muted/40 text-muted-foreground" };
}

function ProcessCard({ process }: { process: DisplayProcess }) {
  const [expanded, setExpanded] = useState(false);
  const hasAndamentos = process.andamentos.length > 0;
  const valorBRL = formatBRL(process.valor);
  const poloMeta = poloUi(process.polo);
  const partePrincipal = process.parteContraria.length > 0 ? process.parteContraria[0] : null;
  const outrasPartes = process.parteContraria.slice(1);

  return (
    <div className="border border-border/50 rounded-lg overflow-hidden bg-card/30">
      <div className="px-4 py-3 space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-xs text-muted-foreground truncate max-w-[220px]">
                {process.numeroProcesso || "—"}
              </span>
              {process.ano && (
                <span className="text-xs bg-muted/40 px-1.5 py-0.5 rounded shrink-0">{process.ano}</span>
              )}
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full shrink-0 ${poloMeta.className}`}>{poloMeta.label}</span>
              {process.grau && <span className="text-xs text-muted-foreground/60 shrink-0">{process.grau}</span>}
              <span className="text-xs text-muted-foreground/50 shrink-0">{process.tribunalName}</span>
              <span className="text-[10px] text-muted-foreground/40 shrink-0 uppercase">({process.tribunalId})</span>
            </div>
            {process.classeNome && <p className="text-sm font-medium mt-0.5">{process.classeNome}</p>}
          </div>
          {valorBRL && <span className="text-xs font-mono text-muted-foreground shrink-0 pt-0.5">{valorBRL}</span>}
        </div>

        {process.assuntos.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {process.assuntos.slice(0, 3).map((assunto, i) => (
              <span key={`${assunto}-${i}`} className="text-xs bg-muted/30 px-1.5 py-0.5 rounded text-muted-foreground">
                {assunto}
              </span>
            ))}
          </div>
        )}

        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {process.dataAjuizamento && (
            <span className="flex items-center gap-1">
              <Calendar className="w-3 h-3 shrink-0" />
              {formatDate(process.dataAjuizamento)}
            </span>
          )}
          {process.orgaoJulgadorNome && (
            <span className="flex items-center gap-1 truncate max-w-[240px]">
              <Building2 className="w-3 h-3 shrink-0" />
              {process.orgaoJulgadorNome}
            </span>
          )}
          {partePrincipal && (
            <span>
              Parte contrária principal: <span className="text-foreground/80">{partePrincipal}</span>
              {outrasPartes.length > 0 && (
                <span className="text-muted-foreground">
                  {" "}
                  | outras: {outrasPartes.join(", ")}
                </span>
              )}
            </span>
          )}
          {process.sourceUrl && (
            <a
              href={process.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-primary hover:underline"
            >
              Abrir processo <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>

        {hasAndamentos && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors mt-0.5"
          >
            {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            {expanded ? "Ocultar" : "Ver"} {process.andamentos.length} andamento
            {process.andamentos.length !== 1 ? "s" : ""}
          </button>
        )}
      </div>

      {expanded && hasAndamentos && (
        <div className="border-t border-border/40 px-4 py-3 space-y-2 bg-muted/10">
          {process.andamentos.map((a, i) => (
            <div key={`${a.nome}-${i}`} className="flex gap-3 text-xs">
              <span className="text-muted-foreground/60 shrink-0 w-[4.5rem]">{formatDate(a.dataHora)}</span>
              <div className="min-w-0">
                <span className="text-foreground/80">{a.nome}</span>
                {a.complemento && <span className="text-muted-foreground"> — {a.complemento}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TypeGroup({ type, processes }: { type: ProcessType; processes: DisplayProcess[] }) {
  const [expanded, setExpanded] = useState(type === "criminal" || type === "fiscal");
  const config = TYPE_CONFIG[type];

  return (
    <div className={`border rounded-lg overflow-hidden ${config.bg}`}>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-black/5 dark:hover:bg-white/5 transition-colors text-left"
      >
        <span className={`font-semibold text-sm ${config.color}`}>
          {config.label} <span className="font-normal text-muted-foreground">({processes.length})</span>
        </span>
        {expanded ? (
          <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" />
        ) : (
          <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
        )}
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-3">
          {processes.map((p) => (
            <ProcessCard key={`${p.tribunalId}-${p.numeroProcesso}`} process={p} />
          ))}
        </div>
      )}
    </div>
  );
}

const TYPE_ORDER: ProcessType[] = ["criminal", "fiscal", "trabalhista", "civil", "outro"];

function statusLabel(status: string) {
  if (status === "success") return "Com registros";
  if (status === "not_found") return "Sem registros";
  if (status === "error") return "Erro";
  return "Indisponível";
}

function statusClass(status: string) {
  if (status === "success") return "text-risk-low";
  if (status === "not_found") return "text-muted-foreground";
  if (status === "error") return "text-risk-high";
  return "text-risk-medium";
}

function statusReasonLabel(reason?: string) {
  const value = String(reason ?? "").trim();
  if (!value) return "—";

  const map: Record<string, string> = {
    match_found: "Encontrou processos",
    not_listed: "Sem registros no tribunal consultável",
    partial_coverage_no_match: "Cobertura parcial sem match",
    entity_lookup_not_supported_public_api: "API pública não suporta lookup por entidade",
    unsupported_query_mode: "Método não suportado",
    captcha_blocked: "Bloqueado por captcha",
    timeout_or_network: "Timeout/rede",
    unauthorized: "Não autorizado",
    rate_limited: "Limite de requisições",
    parser_error: "Erro de parser",
    no_tribunal_response: "Sem resposta do tribunal",
    deferred_datajud_enrichment: "DataJud adiado para enriquecimento",
    deferred_to_crawler: "DataJud só após crawler",
  };

  return map[value] ?? value;
}

function getDatajudEnrichmentMetrics(
  coverageItems: InvestigationJudicialCoverageResponse["items"],
  foundProcesses: number,
) {
  let attempted = 0;
  let enriched = 0;
  let failed = 0;
  let unavailable = 0;

  for (const item of coverageItems) {
    const enrichment = item?.metadata?.datajud_enrichment;
    if (!enrichment || typeof enrichment !== "object") continue;

    const attempt = Number((enrichment as Record<string, unknown>).attempted ?? 0) || 0;
    const done = Number((enrichment as Record<string, unknown>).enriched ?? 0) || 0;
    const fail = Number((enrichment as Record<string, unknown>).failed ?? 0) || 0;
    const unavail = Number((enrichment as Record<string, unknown>).unavailable ?? 0) || 0;
    attempted += attempt;
    enriched += done;
    failed += fail;
    unavailable += unavail;
  }

  const state =
    attempted === 0
      ? foundProcesses > 0
        ? "pending"
        : "not_processed"
      : enriched > 0
        ? "enriched"
        : failed > 0
          ? "failed"
          : "pending";

  return { attempted, enriched, failed, unavailable, state };
}

export function DatajudSection({
  processes,
  judicialCoverage,
  judicialProcesses,
  judicialSummary,
}: DatajudSectionProps) {
  const normalizedProcesses = useMemo(
    () => normalizeProcesses(judicialProcesses, processes),
    [judicialProcesses, processes],
  );

  const coverageItems = useMemo(() => judicialCoverage?.items ?? [], [judicialCoverage]);
  const summary = judicialCoverage?.summary ?? judicialSummary;

  const [ramoFilter, setRamoFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [methodFilter, setMethodFilter] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");

  const filteredCoverage = useMemo(() => {
    return coverageItems.filter((item) => {
      if (ramoFilter !== "all" && item.ramo !== ramoFilter) return false;
      if (statusFilter !== "all" && item.status !== statusFilter) return false;
      if (methodFilter !== "all" && item.query_mode !== methodFilter) return false;
      if (searchTerm.trim()) {
        const text = `${item.tribunal_name} ${item.tribunal_id}`.toLowerCase();
        if (!text.includes(searchTerm.trim().toLowerCase())) return false;
      }
      return true;
    });
  }, [coverageItems, ramoFilter, statusFilter, methodFilter, searchTerm]);

  const groups: Record<ProcessType, DisplayProcess[]> = {
    criminal: [],
    fiscal: [],
    trabalhista: [],
    civil: [],
    outro: [],
  };
  for (const process of normalizedProcesses) {
    groups[classifyProcess(process)].push(process);
  }
  const activeTypes = TYPE_ORDER.filter((type) => groups[type].length > 0);

  const hasCoverage = coverageItems.length > 0 || Boolean(summary);
  const hasProcesses = normalizedProcesses.length > 0;
  if (!hasCoverage && !hasProcesses) return null;

  const enrichmentMetrics = getDatajudEnrichmentMetrics(
    coverageItems,
    Number(summary?.found_processes ?? 0),
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.2 }}
      className="glass-card p-6 space-y-4"
    >
      <div className="flex items-center gap-2 flex-wrap">
        <Scale className="w-5 h-5 text-primary" />
        <h2 className="text-lg font-semibold">Cobertura Judicial Nacional</h2>
      </div>

      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          <div className="rounded-lg border border-border/60 bg-secondary/20 px-3 py-2">
            <p className="text-xs text-muted-foreground">Tribunais suportados</p>
            <p className="text-lg font-semibold">{summary.supported ?? 0}</p>
          </div>
          <div className="rounded-lg border border-border/60 bg-secondary/20 px-3 py-2">
            <p className="text-xs text-muted-foreground">Tribunais consultados</p>
            <p className="text-lg font-semibold">{summary.consulted ?? 0}</p>
          </div>
          <div className="rounded-lg border border-border/60 bg-secondary/20 px-3 py-2">
            <p className="text-xs text-muted-foreground">Tribunais indisponíveis</p>
            <p className="text-lg font-semibold">{summary.unavailable ?? 0}</p>
          </div>
          <div className="rounded-lg border border-border/60 bg-secondary/20 px-3 py-2">
            <p className="text-xs text-muted-foreground">Processos encontrados</p>
            <p className="text-lg font-semibold">{summary.found_processes ?? 0}</p>
          </div>
          <div className="rounded-lg border border-border/60 bg-secondary/20 px-3 py-2 col-span-2 md:col-span-1">
            <p className="text-xs text-muted-foreground">DataJud (enriquecimento)</p>
            <p className="text-sm font-semibold">
              {enrichmentMetrics.state === "not_processed" && "Não processado"}
              {enrichmentMetrics.state === "pending" && "Em andamento"}
              {enrichmentMetrics.state === "failed" && "Processado e falhou"}
              {enrichmentMetrics.state === "enriched" &&
                `Enriquecido ${enrichmentMetrics.enriched}/${enrichmentMetrics.attempted}`}
            </p>
            {(enrichmentMetrics.failed > 0 || enrichmentMetrics.unavailable > 0) && (
              <p className="text-[11px] text-muted-foreground">
                falhas: {enrichmentMetrics.failed} | indisponível: {enrichmentMetrics.unavailable}
              </p>
            )}
          </div>
        </div>
      )}

      {hasCoverage && (
        <>
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>
              A ausência de processo só é conclusiva quando o tribunal está com status consultável.
              Tribunais indisponíveis/limitados não implicam “empresa sem processos”.
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-2">
            <label className="rounded border border-border/60 bg-secondary/20 px-2 py-1.5 text-xs">
              Ramo
              <select
                className="w-full mt-1 bg-transparent outline-none"
                value={ramoFilter}
                onChange={(event) => setRamoFilter(event.target.value)}
              >
                <option value="all">Todos</option>
                <option value="superior">Superior</option>
                <option value="federal">Federal</option>
                <option value="trabalhista">Trabalhista</option>
                <option value="estadual">Estadual</option>
                <option value="eleitoral">Eleitoral</option>
              </select>
            </label>

            <label className="rounded border border-border/60 bg-secondary/20 px-2 py-1.5 text-xs">
              Status
              <select
                className="w-full mt-1 bg-transparent outline-none"
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
              >
                <option value="all">Todos</option>
                <option value="success">Com registros</option>
                <option value="not_found">Sem registros</option>
                <option value="unavailable">Indisponível</option>
                <option value="error">Erro</option>
              </select>
            </label>

            <label className="rounded border border-border/60 bg-secondary/20 px-2 py-1.5 text-xs">
              Método
              <select
                className="w-full mt-1 bg-transparent outline-none"
                value={methodFilter}
                onChange={(event) => setMethodFilter(event.target.value)}
              >
                <option value="all">Todos</option>
                <option value="cnpj_exact">CNPJ exato</option>
                <option value="party_name">Nome da parte</option>
                <option value="process_number">Número do processo</option>
              </select>
            </label>

            <label className="rounded border border-border/60 bg-secondary/20 px-2 py-1.5 text-xs flex items-center gap-2">
              <Search className="w-3.5 h-3.5 text-muted-foreground" />
              <input
                className="w-full bg-transparent outline-none"
                placeholder="Filtrar tribunal"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
              />
            </label>
          </div>

          <div className="rounded-lg border border-border/60 overflow-hidden">
            <div className="max-h-[360px] overflow-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-background/95 backdrop-blur border-b border-border/60">
                  <tr className="text-left text-muted-foreground">
                    <th className="px-3 py-2">Tribunal</th>
                    <th className="px-3 py-2">Conector</th>
                    <th className="px-3 py-2">Método</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Motivo técnico</th>
                    <th className="px-3 py-2">Latência</th>
                    <th className="px-3 py-2">Evidências</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCoverage.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-3 py-4 text-center text-muted-foreground">
                        Sem itens para os filtros selecionados.
                      </td>
                    </tr>
                  )}
                  {filteredCoverage.map((item) => (
                    <tr key={`${item.tribunal_id}-${item.query_mode}`} className="border-b border-border/40">
                      <td className="px-3 py-2">
                        <div className="font-medium">{item.tribunal_name}</div>
                        <div className="text-[11px] text-muted-foreground uppercase">{item.ramo}</div>
                      </td>
                      <td className="px-3 py-2 uppercase">{item.connector_family}</td>
                      <td className="px-3 py-2">{item.query_mode}</td>
                      <td className={`px-3 py-2 font-medium ${statusClass(item.status)}`}>{statusLabel(item.status)}</td>
                      <td className="px-3 py-2 text-muted-foreground">
                        <div>{statusReasonLabel(item.status_reason)}</div>
                        {item.status_reason && (
                          <div className="text-[10px] text-muted-foreground/60">{item.status_reason}</div>
                        )}
                        {item.message && (
                          <div className="text-[10px] text-muted-foreground/80 mt-1 max-w-[340px]">
                            {item.message}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2">{item.latency_ms != null ? `${item.latency_ms}ms` : "—"}</td>
                      <td className="px-3 py-2">{item.evidence_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {hasProcesses ? (
        <>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <ShieldAlert className="w-4 h-4 text-primary" />
            Detalhes dos processos encontrados ({normalizedProcesses.length})
          </div>

          <div className="space-y-3">
            {activeTypes.map((type) => (
              <TypeGroup key={type} type={type} processes={groups[type]} />
            ))}
          </div>
        </>
      ) : (
        <p className="text-xs text-muted-foreground">
          Nenhum processo confirmado com evidência mínima na varredura atual.
        </p>
      )}

      <p className="text-xs text-muted-foreground/40 pt-1">
        Fonte judicial: DataJud CNJ + conectores por família de tribunal. Quando um tribunal estiver indisponível,
        o sistema mostra status técnico em vez de concluir ausência de processos.
      </p>
    </motion.div>
  );
}
