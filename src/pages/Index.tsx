import { useEffect, useMemo, useState, type ReactNode } from "react";
import { cleanCNPJ, formatCNPJ, isValidCNPJ } from "@/lib/cnpj";
import { EnvironmentalDetailSheet, type DetailPanelItem, type DetailPanelLink } from "@/components/EnvironmentalDetailSheet";
import { useNavigate, useParams } from "react-router-dom";
import type {
  ActionPlanPriority,
  ActionPlanStatus,
  AreasContaminadasScreenshotCapture,
  AreasContaminadasResult,
  EnvironmentalActionPlanItem,
  EnvironmentalAiReport,
  EnvironmentalCompany,
  EnvironmentalComplianceResult,
  FteDeepAnalysis,
  IbamaResult,
  NationalMunicipalResult,
  NationalStateResult,
} from "@/types/environmental";

const API_BASE_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ?? "";
const COMPLIANCE_ENDPOINT = API_BASE_URL ? `${API_BASE_URL}/api/environmental-compliance` : "/api/environmental-compliance";
const COMPLIANCE_HISTORY_ENDPOINT = API_BASE_URL
  ? `${API_BASE_URL}/api/environmental-compliance/history`
  : "/api/environmental-compliance/history";
const COMPLIANCE_BASE_ENDPOINT = API_BASE_URL ? `${API_BASE_URL}/api/environmental-compliance` : "/api/environmental-compliance";
const AREAS_SCREENSHOT_ENDPOINT = API_BASE_URL
  ? `${API_BASE_URL}/api/areas-contaminadas/screenshot`
  : "/api/areas-contaminadas/screenshot";

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function analyzeEnvironmentalCompliance(cnpj: string): Promise<EnvironmentalComplianceResult> {
  const response = await fetch(COMPLIANCE_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cnpj }),
  });

  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      data && typeof data === "object" && "error" in data && typeof data.error === "string"
        ? data.error
        : "Não foi possível executar a análise ambiental.";
    throw new Error(message);
  }

  if (!data || typeof data !== "object") {
    throw new Error("Resposta inválida da API.");
  }

  return data as EnvironmentalComplianceResult;
}

async function loadEnvironmentalComplianceById(analysisId: string): Promise<EnvironmentalComplianceResult> {
  const response = await fetch(`${COMPLIANCE_BASE_ENDPOINT}/${encodeURIComponent(analysisId)}`, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
  });

  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      data && typeof data === "object" && "error" in data && typeof data.error === "string"
        ? data.error
        : "Não foi possível reabrir a análise ambiental.";
    throw new Error(message);
  }

  if (!data || typeof data !== "object") {
    throw new Error("Resposta inválida da API ao reabrir análise.");
  }

  return data as EnvironmentalComplianceResult;
}

async function patchEnvironmentalActionPlan(analysisId: string, items: EnvironmentalActionPlanItem[]) {
  const response = await fetch(`${COMPLIANCE_BASE_ENDPOINT}/${encodeURIComponent(analysisId)}/action-plan`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items }),
  });

  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      data && typeof data === "object" && "error" in data && typeof data.error === "string"
        ? data.error
        : "Falha ao atualizar plano de ação.";
    throw new Error(message);
  }

  if (!data || typeof data !== "object") {
    throw new Error("Resposta inválida da API ao atualizar plano de ação.");
  }

  return data as { analysis_id: string; action_plan: { items: EnvironmentalActionPlanItem[] } };
}

async function fetchEnvironmentalHistory(cnpj: string) {
  const params = new URLSearchParams();
  const clean = cleanCNPJ(cnpj);
  if (clean.length === 14) params.set("cnpj", clean);
  params.set("page", "1");
  params.set("limit", "8");
  const endpoint = `${COMPLIANCE_HISTORY_ENDPOINT}?${params.toString()}`;
  const response = await fetch(endpoint, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
  });
  if (!response.ok) return [];
  const data: any = await response.json().catch(() => null);
  return Array.isArray(data?.items) ? data.items : [];
}

async function captureAreasContaminadasEvidence(params: {
  mapUrl: string;
  razaoSocial: string;
  cnpj: string;
}): Promise<AreasContaminadasScreenshotCapture> {
  const response = await fetch(AREAS_SCREENSHOT_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      map_url: params.mapUrl,
      razao_social: params.razaoSocial,
      cnpj: params.cnpj,
      include_base64: true,
    }),
  });

  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      data && typeof data === "object" && "error" in data && typeof data.error === "string"
        ? data.error
        : "Falha ao capturar screenshot de áreas contaminadas.";
    throw new Error(message);
  }

  if (!data || typeof data !== "object" || !("capture" in data)) {
    throw new Error("Resposta inválida da captura de screenshot.");
  }

  return (data as { capture: AreasContaminadasScreenshotCapture }).capture;
}

type BadgeType = "alto" | "medio" | "baixo" | "info" | "neutral";

function Badge({ type, children }: { type: BadgeType; children: ReactNode }) {
  const colors: Record<BadgeType, string> = {
    alto: "bg-red-100 text-red-800 border border-red-200",
    medio: "bg-amber-100 text-amber-800 border border-amber-200",
    baixo: "bg-emerald-100 text-emerald-800 border border-emerald-200",
    info: "bg-sky-100 text-sky-800 border border-sky-200",
    neutral: "bg-gray-100 text-gray-700 border border-gray-200",
  };

  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${colors[type]}`}>
      {children}
    </span>
  );
}

function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-sky-700 hover:text-sky-900 underline decoration-sky-300 hover:decoration-sky-500 transition-colors text-sm"
    >
      {children}
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
      </svg>
    </a>
  );
}

function AgentCard({
  number,
  title,
  icon,
  status,
  children,
}: {
  number: number;
  title: string;
  icon: string;
  status: "success" | "warning" | "danger" | "info" | "idle";
  children: ReactNode;
}) {
  const [open, setOpen] = useState(true);
  const statusColors = {
    success: "border-l-emerald-500 bg-emerald-50/30",
    warning: "border-l-amber-500 bg-amber-50/30",
    danger: "border-l-red-500 bg-red-50/30",
    info: "border-l-sky-500 bg-sky-50/30",
    idle: "border-l-gray-300 bg-white",
  };

  return (
    <div className={`rounded-lg border border-gray-200 border-l-4 ${statusColors[status]} overflow-hidden shadow-sm transition-all duration-300`}>
      <button
        onClick={() => setOpen((value) => !value)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-white/50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-gray-800 text-white flex items-center justify-center text-sm font-bold flex-shrink-0">{number}</div>
          <span className="text-xl mr-2">{icon}</span>
          <h3 className="font-semibold text-gray-900 text-left">{title}</h3>
        </div>
        <svg className={`w-5 h-5 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && <div className="px-5 pb-5 border-t border-gray-100">{children}</div>}
    </div>
  );
}

function Spinner() {
  return (
    <div className="flex items-center gap-3 py-4">
      <div className="w-5 h-5 border-2 border-gray-300 border-t-gray-800 rounded-full animate-spin" />
      <span className="text-sm text-gray-500">Processando agente...</span>
    </div>
  );
}

function riskBadgeType(value: string | undefined): BadgeType {
  if (value === "alto") return "alto";
  if (value === "medio") return "medio";
  if (value === "baixo") return "baixo";
  return "neutral";
}

type ComplianceMode = "executive" | "auditor";

function normalizeMode(value: string | undefined): ComplianceMode {
  return value === "auditor" ? "auditor" : "executive";
}

function normalizeActionPriority(value: string | null | undefined): ActionPlanPriority {
  const normalized = String(value ?? "").toLowerCase();
  if (normalized === "alta") return "alta";
  if (normalized === "baixa") return "baixa";
  return "media";
}

function normalizeActionStatus(value: string | null | undefined): ActionPlanStatus {
  const normalized = String(value ?? "").toLowerCase();
  if (normalized === "em_andamento") return "em_andamento";
  if (normalized === "concluido") return "concluido";
  return "pendente";
}

function normalizeActionPlanItems(items: unknown): EnvironmentalActionPlanItem[] {
  if (!Array.isArray(items)) return [];
  return items
    .map((item, index) => {
      if (!item || typeof item !== "object") return null;
      const raw = item as Record<string, unknown>;
      const id = String(raw.id ?? `ap_${index + 1}`).trim();
      const title = String(raw.title ?? "").trim();
      if (!id || !title) return null;
      return {
        id,
        title,
        priority: normalizeActionPriority(String(raw.priority ?? "media")),
        owner: raw.owner ? String(raw.owner) : null,
        due_date: raw.due_date ? String(raw.due_date).slice(0, 10) : null,
        status: normalizeActionStatus(String(raw.status ?? "pendente")),
        source_refs: Array.isArray(raw.source_refs) ? raw.source_refs.map((entry) => String(entry)) : [],
      } satisfies EnvironmentalActionPlanItem;
    })
    .filter((item): item is EnvironmentalActionPlanItem => Boolean(item));
}

function buildExecutiveFallback(result: EnvironmentalComplianceResult | null, fteDeep: FteDeepAnalysis | null, areas: AreasContaminadasResult | null) {
  if (!result) {
    return {
      critical_obligations: [] as string[],
      coverage_gaps: [] as string[],
      top_risks: [] as Array<{ sphere: string; severity: string; title: string; detail: string }>,
    };
  }

  const federalIbamaMatches = result?.federal?.ibama?.matches ?? result?.ibama?.matches ?? [];
  const stateMatches = result?.state?.details?.matches ?? result?.cetesb?.matches ?? [];
  const municipalMatches = result?.municipal?.details?.matches ?? result?.municipal_legacy?.matches ?? [];

  const critical_obligations = [
    ...(result?.federal?.obligations ?? []),
    ...((federalIbamaMatches ?? []).map((item) => item.obrigacao).filter(Boolean) as string[]),
    ...(result?.state?.obligations ?? []),
    ...(result?.municipal?.obligations ?? []),
    ...(stateMatches ?? []).map((item) => item?.obrigacao).filter(Boolean),
    ...(municipalMatches ?? []).map((item) => item?.enquadramento).filter(Boolean),
  ]
    .filter(Boolean)
    .filter((item, index, list) => list.indexOf(item) === index)
    .slice(0, 3);

  const coverage_gaps = [
    result?.coverage?.federal?.status !== "api_ready" ? "Cobertura federal parcial/manual." : "",
    result?.coverage?.state?.status !== "api_ready" ? "Cobertura estadual exige validação manual complementar." : "",
    result?.coverage?.municipal?.status !== "api_ready" ? "Cobertura municipal exige validação manual complementar." : "",
    result?.coverage?.ambiental_territorial?.status !== "api_ready" ? "Cobertura territorial parcial/manual." : "",
    !fteDeep?.available ? `RAG/FTE em fallback: ${fteDeep?.reason || "indisponível"}.` : "",
    areas?.method !== "api_match" ? "Áreas contaminadas em fluxo manual assistido." : "",
  ]
    .filter(Boolean)
    .slice(0, 3);

  const top_risks = [
    ...(federalIbamaMatches ?? []).map((item) => ({
      sphere: "federal",
      severity: item.risco,
      title: `IBAMA Cat. ${item.categoria}`,
      detail: item.obrigacao,
    })),
    ...((stateMatches ?? []).map((item) => ({
      sphere: "estadual",
      severity: item.risco,
      title: `CNAE ${item.cnae} (estadual)`,
      detail: item.obrigacao,
    })) as Array<{ sphere: string; severity: string; title: string; detail: string }>),
    ...((municipalMatches ?? []).map((item) => ({
      sphere: "municipal",
      severity: item.risco,
      title: `CNAE ${item.cnae} (municipal)`,
      detail: item.enquadramento,
    })) as Array<{ sphere: string; severity: string; title: string; detail: string }>),
    ...((areas?.matches ?? []).map((item) => ({
      sphere: "ambiental_territorial",
      severity: item.risco,
      title: item.empreendimento || "Match territorial",
      detail: `Score ${item.score.toFixed(2)} em ${item.layer_name}.`,
    })) as Array<{ sphere: string; severity: string; title: string; detail: string }>),
  ]
    .sort((a, b) => {
      const aw = a.severity === "alto" ? 3 : a.severity === "medio" ? 2 : 1;
      const bw = b.severity === "alto" ? 3 : b.severity === "medio" ? 2 : 1;
      return bw - aw;
    })
    .slice(0, 3);

  return {
    critical_obligations,
    coverage_gaps,
    top_risks,
  };
}

function buildFallbackActionPlan(items: string[]): EnvironmentalActionPlanItem[] {
  const normalizedItems = items.length
    ? items
    : [
        "Validar enquadramento federal (CTF/APP) e FTE aplicável.",
        "Confirmar licenciamento estadual/municipal com base nos CNAEs da empresa.",
        "Organizar trilha de evidências com responsável e prazo.",
      ];
  return normalizedItems.slice(0, 6).map((title, index) => ({
    id: `fallback_ap_${index + 1}`,
    title,
    priority: index < 2 ? "alta" : "media",
    owner: null,
    due_date: null,
    status: "pendente",
    source_refs: [],
  }));
}

function buildAiFallback(raw: Record<string, any>, payload: EnvironmentalComplianceResult): EnvironmentalAiReport {
  if (payload?.ai_report && typeof payload.ai_report === "object") {
    return payload.ai_report;
  }
  const source = Array.isArray(raw?.sources)
    ? raw.sources.find((item: any) => item?.id === "openai_relatorio_ambiental")
    : null;
  const orchestrationStep = Array.isArray(raw?.orchestration?.steps)
    ? raw.orchestration.steps.find((step: any) => step?.agent === "agent_7_relatorio_ai")
    : null;
  const reasonParts = [
    typeof source?.status_reason === "string" ? source.status_reason : "",
    typeof source?.message === "string" ? source.message : "",
    typeof orchestrationStep?.message === "string" ? orchestrationStep.message : "",
  ].filter(Boolean);
  return {
    available: false,
    reason: reasonParts[0] || "ai_report_missing",
  };
}

function humanizeCoverageStatus(status: string | null | undefined) {
  const normalized = String(status ?? "").toLowerCase();
  if (normalized === "api_ready") return "Automatizado";
  if (normalized === "manual_required") return "Revisão manual necessária";
  return "Parcial";
}

function humanizeCoverageMode(mode: string | null | undefined) {
  const normalized = String(mode ?? "").toLowerCase();
  if (normalized.includes("api")) return "Consulta automática";
  if (normalized.includes("manual")) return "Consulta manual assistida";
  if (normalized.includes("dataset")) return "Consulta por base estruturada";
  return "Consulta parcial";
}

function humanizeSourceStatus(status: string | null | undefined) {
  const normalized = String(status ?? "").toLowerCase();
  if (normalized === "success") return "Sucesso";
  if (normalized === "not_found") return "Sem achados";
  if (normalized === "unavailable") return "Indisponível";
  if (normalized === "error") return "Falha";
  return "Parcial";
}

function humanizeSourceReason(reason: string | null | undefined) {
  const normalized = String(reason ?? "").toLowerCase();
  if (!normalized) return "Sem detalhe adicional";
  if (normalized === "ok" || normalized === "rule_match" || normalized === "http_reachable") return "Consulta concluída";
  if (normalized === "no_match" || normalized === "not_found") return "Nenhum registro localizado";
  if (normalized === "missing_api_key") return "Credencial da fonte não configurada";
  if (normalized === "timeout_or_network") return "Timeout ou instabilidade de rede";
  if (normalized === "manual_required" || normalized === "manual_assisted_flow") return "Exige verificação manual";
  if (normalized.startsWith("http_")) return `Erro remoto (${normalized.toUpperCase()})`;
  return normalized.replaceAll("_", " ");
}

function humanizeExecutionStatus(status: string | null | undefined) {
  const normalized = String(status ?? "").toLowerCase();
  if (normalized === "completed" || normalized === "success") return "Concluído";
  if (normalized === "running") return "Em andamento";
  if (normalized === "failed" || normalized === "error") return "Falha";
  if (normalized === "partial") return "Parcial";
  if (normalized === "pending") return "Pendente";
  return normalized ? normalized.replaceAll("_", " ") : "Parcial";
}

function humanizeAreasMethod(method: string | null | undefined, status: string | null | undefined) {
  const normalized = String(method ?? "").toLowerCase();
  if (normalized === "api_match") return "Match automático em base oficial";
  if (normalized === "dataset_match") return "Match por base estruturada";
  if (String(status ?? "").toLowerCase() === "match_found") return "Match localizado";
  return "Consulta manual assistida";
}

function humanizePersistence(mode: string | null | undefined, durable: boolean | null | undefined) {
  if (durable) return "Histórico salvo em banco";
  const normalized = String(mode ?? "").toLowerCase();
  if (normalized.includes("database")) return "Histórico salvo em banco";
  if (normalized.includes("memory")) return "Sessão temporária (cache em memória)";
  return "Sessão temporária";
}

function removeMarkdownSyntax(text: string) {
  return String(text ?? "")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/^\s*[-*]\s+/gm, "• ")
    .replace(/^\s*\d+\.\s+/gm, "• ")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const SEMIL_MAP_URL = "https://mapas.semil.sp.gov.br/portal/apps/webappviewer/index.html?id=77da778c122c4ccda8a8d6babce61b6b";

function defaultCetesbResult() {
  return {
    enquadrado: false,
    matches: [],
    lp_precedente: false,
    rmsp_restricoes: false,
    nota_rmsp: null,
    links: {
      atividades: "",
      tabela_atividades: "",
      portal_licenciamento: "",
    },
  };
}

function defaultMunicipalLegacyResult() {
  return {
    enquadrado: false,
    matches: [],
    legislacao: {
      lc140: "",
      consema: "",
      municipios_habilitados: "",
    },
    nota: "",
  };
}

function buildRagFallback(raw: Record<string, any>): FteDeepAnalysis {
  const ragSource = Array.isArray(raw?.sources)
    ? raw.sources.find((item: any) => item?.id === "openai_fte_rag")
    : null;

  const reasonFromSource =
    ragSource && typeof ragSource === "object"
      ? `RAG indisponivel (${humanizeSourceStatus(ragSource.status)} / ${humanizeSourceReason(ragSource.status_reason)})`
      : null;

  const legacyHint =
    "API respondeu sem bloco fte_deep_analysis (contrato legado). Atualize/reinicie o backend para br-v1.";

  return {
    available: false,
    reason: reasonFromSource || legacyHint,
    executive_summary: "",
    findings: [],
    overall_recommendations: [],
    legal_risks: [],
    citations: [],
    stats: {
      total_findings: 0,
      high_risk_findings: 0,
      medium_risk_findings: 0,
      low_risk_findings: 0,
    },
  };
}

function dedupeDetailLinks(links: DetailPanelLink[]) {
  const seen = new Set<string>();
  const deduped: DetailPanelLink[] = [];
  for (const link of links) {
    const href = String(link?.href ?? "").trim();
    const label = String(link?.label ?? "").trim();
    if (!href || !label) continue;
    const key = `${label}|${href}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push({ label, href });
  }
  return deduped;
}

function DetailActionButton({
  onClick,
  label = "Detalhar",
}: {
  onClick: () => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center rounded-md border border-gray-300 px-2 py-1 text-[11px] font-medium text-gray-700 hover:bg-gray-50"
    >
      {label}
    </button>
  );
}

export default function Index() {
  const navigate = useNavigate();
  const { analysisId, mode } = useParams();
  const [localMode, setLocalMode] = useState<ComplianceMode>("executive");
  const activeMode = mode ? normalizeMode(mode) : localMode;
  const [cnpj, setCnpj] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingSavedAnalysis, setLoadingSavedAnalysis] = useState(false);
  const [currentAgent, setCurrentAgent] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const [dadosCNPJ, setDadosCNPJ] = useState<EnvironmentalCompany | null>(null);
  const [resultFteDeep, setResultFteDeep] = useState<FteDeepAnalysis | null>(null);
  const [resultIBAMA, setResultIBAMA] = useState<IbamaResult | null>(null);
  const [resultState, setResultState] = useState<NationalStateResult | null>(null);
  const [resultMunicipal, setResultMunicipal] = useState<NationalMunicipalResult | null>(null);
  const [resultAreas, setResultAreas] = useState<AreasContaminadasResult | null>(null);
  const [resultAreasCapture, setResultAreasCapture] = useState<AreasContaminadasScreenshotCapture | null>(null);
  const [capturingAreas, setCapturingAreas] = useState(false);
  const [resultAI, setResultAI] = useState<EnvironmentalAiReport | null>(null);
  const [fullResult, setFullResult] = useState<EnvironmentalComplianceResult | null>(null);
  const [actionPlanItems, setActionPlanItems] = useState<EnvironmentalActionPlanItem[]>([]);
  const [actionPlanSaving, setActionPlanSaving] = useState(false);
  const [actionPlanMessage, setActionPlanMessage] = useState<string | null>(null);
  const [historyItems, setHistoryItems] = useState<any[]>([]);
  const [detailPanelItem, setDetailPanelItem] = useState<DetailPanelItem | null>(null);

  const reset = () => {
    setDadosCNPJ(null);
    setResultFteDeep(null);
    setResultIBAMA(null);
    setResultState(null);
    setResultMunicipal(null);
    setResultAreas(null);
    setResultAreasCapture(null);
    setCapturingAreas(false);
    setResultAI(null);
    setFullResult(null);
    setActionPlanItems([]);
    setActionPlanSaving(false);
    setActionPlanMessage(null);
    setHistoryItems([]);
    setDetailPanelItem(null);
    setError(null);
    setLocalMode("executive");
    setCurrentAgent(0);
  };

  const runAreasCapture = async (params: { mapUrl: string; razaoSocial: string; cnpj: string }) => {
    setCapturingAreas(true);
    try {
      const capture = await captureAreasContaminadasEvidence(params);
      setResultAreasCapture(capture);
    } catch {
      setResultAreasCapture(null);
    } finally {
      setCapturingAreas(false);
    }
  };

  const hydratePayload = async (
    payload: EnvironmentalComplianceResult,
    options: { animate: boolean; runCapture: boolean }
  ) => {
    const raw = payload as unknown as Record<string, any>;
    setFullResult(payload);
    setDadosCNPJ(payload.company);
    setCnpj(formatCNPJ(payload.cnpj || ""));
    const rawActionPlanItems = normalizeActionPlanItems(raw?.action_plan?.items ?? payload.action_plan?.items ?? []);

    if (options.animate) {
      setCurrentAgent(1);
      await wait(120);
      setCurrentAgent(2);
    } else {
      setCurrentAgent(8);
    }

    const normalizedFteDeep =
      raw?.fte_deep_analysis && typeof raw.fte_deep_analysis === "object"
        ? (raw.fte_deep_analysis as FteDeepAnalysis)
        : buildRagFallback(raw);
    setResultFteDeep(normalizedFteDeep);

    if (options.animate) {
      await wait(120);
      setCurrentAgent(3);
    }
    setResultIBAMA(payload.federal?.ibama ?? payload.ibama);

    if (options.animate) {
      await wait(120);
      setCurrentAgent(4);
    }
    const normalizedState: NationalStateResult = raw.state && typeof raw.state === "object" && raw.state.details
      ? (raw.state as NationalStateResult)
      : {
          scope: "estadual",
          uf: raw?.jurisdiction_context?.uf ?? raw?.company?.uf ?? null,
          mode: raw?.cetesb ? "api_ready" : "manual_required",
          source_id: raw?.cetesb ? "sp_cetesb_licenciamento" : "estadual_licenciamento_default",
          available: Boolean(raw?.cetesb),
          details: (raw?.cetesb as NationalStateResult["details"]) ?? defaultCetesbResult(),
          obligations: [],
          nota: raw?.cetesb
            ? "Compatibilidade aplicada a partir do contrato legado CETESB."
            : "Sem dados estaduais estruturados na resposta atual.",
        };
    setResultState(normalizedState);

    if (options.animate) {
      await wait(120);
      setCurrentAgent(5);
    }
    const legacyMunicipal =
      raw?.municipal_legacy ??
      (raw?.municipal && (!raw.municipal.details || raw.municipal.mode == null) ? raw.municipal : null);
    const normalizedMunicipal: NationalMunicipalResult = raw?.municipal && raw.municipal.details && raw.municipal.mode
      ? (raw.municipal as NationalMunicipalResult)
      : {
          scope: "municipal",
          uf: raw?.jurisdiction_context?.uf ?? raw?.company?.uf ?? null,
          municipio_nome: raw?.jurisdiction_context?.municipio_nome ?? raw?.company?.municipio ?? null,
          mode: legacyMunicipal ? "api_ready" : "manual_required",
          source_id: legacyMunicipal ? "sp_consema_municipal" : "municipal_licenciamento_generico",
          available: Boolean(legacyMunicipal),
          details: (legacyMunicipal as NationalMunicipalResult["details"]) ?? defaultMunicipalLegacyResult(),
          obligations: [],
          nota: legacyMunicipal
            ? "Compatibilidade aplicada a partir do contrato legado municipal."
            : "Sem dados municipais estruturados na resposta atual.",
        };
    setResultMunicipal(normalizedMunicipal);

    if (options.animate) {
      await wait(120);
      setCurrentAgent(6);
    }
    const normalizedAreas: AreasContaminadasResult =
      raw?.areas_contaminadas && Array.isArray(raw.areas_contaminadas.matches)
        ? (raw.areas_contaminadas as AreasContaminadasResult)
        : {
            available: false,
            method: "manual_required",
            status: "legacy_contract",
            summary:
              raw?.areas_contaminadas?.instrucao ?? "Resposta legada sem evidências estruturadas de áreas contaminadas.",
            matches: [],
            official_map_embed_url: SEMIL_MAP_URL,
            official_map_open_url: SEMIL_MAP_URL,
            evidence_refs: [],
            limitations: raw?.areas_contaminadas?.alerta
              ? [String(raw.areas_contaminadas.alerta)]
              : ["Contrato legado detectado; mantendo modo manual assistido."],
        };
    setResultAreas(normalizedAreas);

    if (rawActionPlanItems.length > 0) {
      setActionPlanItems(rawActionPlanItems);
    } else {
      const fallbackExecutive = buildExecutiveFallback(payload, normalizedFteDeep, normalizedAreas);
      const fallbackTitles = [
        ...fallbackExecutive.critical_obligations.map((item) => `Executar obrigação crítica: ${item}`),
        ...fallbackExecutive.coverage_gaps.map((item) => `Mitigar lacuna: ${item}`),
      ].filter(Boolean);
      setActionPlanItems(buildFallbackActionPlan(fallbackTitles));
    }

    if (options.runCapture) {
      await runAreasCapture({
        mapUrl: normalizedAreas.official_map_open_url || SEMIL_MAP_URL,
        razaoSocial: String(raw?.company?.razao_social ?? raw?.company?.nome_fantasia ?? ""),
        cnpj: String(raw?.cnpj ?? cleanCNPJ(cnpj)),
      });
    }

    if (options.animate) {
      await wait(120);
      setCurrentAgent(7);
    }
    setResultAI(buildAiFallback(raw, payload));

    if (options.animate) {
      await wait(100);
      setCurrentAgent(8);
    }
  };

  const handleRun = async () => {
    const clean = cleanCNPJ(cnpj);
    if (!isValidCNPJ(clean)) {
      setError("CNPJ invalido. Verifique os digitos informados.");
      return;
    }

    reset();
    setLoading(true);
    setCurrentAgent(1);

    try {
      const payload = await analyzeEnvironmentalCompliance(clean);
      await hydratePayload(payload, { animate: true, runCapture: true });
      if (payload.analysis_id) {
        navigate(`/compliance/${payload.analysis_id}/executive`);
      }
      const recentHistory = await fetchEnvironmentalHistory(clean).catch(() => []);
      setHistoryItems(recentHistory);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Falha ao executar análise.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!analysisId || mode) return;
    navigate(`/compliance/${analysisId}/executive`, { replace: true });
  }, [analysisId, mode, navigate]);

  useEffect(() => {
    if (!analysisId) return;
    let cancelled = false;

    const run = async () => {
      setLoadingSavedAnalysis(true);
      setError(null);
      try {
        const payload = await loadEnvironmentalComplianceById(analysisId);
        if (cancelled) return;
        reset();
        await hydratePayload(payload, { animate: false, runCapture: false });
        const recentHistory = await fetchEnvironmentalHistory(payload.cnpj).catch(() => []);
        if (!cancelled) setHistoryItems(recentHistory);
      } catch (requestError) {
        if (cancelled) return;
        setError(requestError instanceof Error ? requestError.message : "Falha ao reabrir análise.");
      } finally {
        if (!cancelled) setLoadingSavedAnalysis(false);
      }
    };

    run().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [analysisId]);

  const setMode = (nextMode: ComplianceMode) => {
    const currentAnalysisId = fullResult?.analysis_id;
    if (!currentAnalysisId) {
      setLocalMode(nextMode);
      return;
    }
    navigate(`/compliance/${currentAnalysisId}/${nextMode}`);
  };

  const updateActionPlanItem = (itemId: string, patch: Partial<EnvironmentalActionPlanItem>) => {
    setActionPlanMessage(null);
    setActionPlanItems((current) =>
      current.map((item) =>
        item.id === itemId
          ? {
              ...item,
              ...patch,
              priority: normalizeActionPriority(patch.priority ?? item.priority),
              status: normalizeActionStatus(patch.status ?? item.status),
            }
          : item
      )
    );
  };

  const persistActionPlan = async () => {
    if (!fullResult?.analysis_id || actionPlanItems.length === 0) return;
    setActionPlanSaving(true);
    setActionPlanMessage(null);
    try {
      const response = await patchEnvironmentalActionPlan(fullResult.analysis_id, actionPlanItems);
      const normalizedItems = normalizeActionPlanItems(response?.action_plan?.items ?? []);
      setActionPlanItems(normalizedItems);
      setFullResult((current) =>
        current
          ? {
              ...current,
              action_plan: {
                items: normalizedItems,
              },
            }
          : current
      );
      setActionPlanMessage("Plano de ação atualizado com sucesso.");
    } catch (requestError) {
      setActionPlanMessage(requestError instanceof Error ? requestError.message : "Falha ao persistir plano de ação.");
    } finally {
      setActionPlanSaving(false);
    }
  };

  const startActionPlan = async () => {
    const firstPending = actionPlanItems.find((item) => item.status === "pendente");
    if (!firstPending) return;
    updateActionPlanItem(firstPending.id, { status: "em_andamento" });
    await wait(50);
    await persistActionPlan();
  };

  const openPdfExport = () => {
    if (!fullResult?.analysis_id) {
      setActionPlanMessage("Exportação PDF requer analysis_id. Rode em backend atualizado para persistência.");
      return;
    }
    window.open(`${COMPLIANCE_BASE_ENDPOINT}/${encodeURIComponent(fullResult.analysis_id)}/export.pdf`, "_blank");
  };

  const downloadJsonExport = () => {
    if (!fullResult) return;
    const blob = new Blob([JSON.stringify(fullResult, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `compliance-ambiental-${cleanCNPJ(fullResult.cnpj || cnpj) || "análise"}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const totalAlerts = fullResult?.summary?.total_alerts ?? 0;
  const areaLayers = useMemo(() => {
    if (!resultAreas?.matches?.length) return [];
    return [...new Set(resultAreas.matches.map((item) => item.layer_name).filter(Boolean))];
  }, [resultAreas]);
  const fteDeepView = resultFteDeep ?? (fullResult ? buildRagFallback(fullResult as unknown as Record<string, any>) : null);
  const ragSource = fullResult?.sources?.find((source) => source.id === "openai_fte_rag");
  const evidenceView = fullResult?.evidence ?? [];
  const coverageView = fullResult?.coverage ?? {
    federal: { status: "manual_required", mode: "manual" },
    state: { status: resultState?.mode === "api_ready" ? "api_ready" : "manual_required", mode: resultState?.mode ?? "manual" },
    municipal: { status: resultMunicipal?.mode === "api_ready" ? "api_ready" : "manual_required", mode: resultMunicipal?.mode ?? "manual" },
    ambiental_territorial: {
      status: resultAreas?.method === "api_match" ? "api_ready" : "manual_required",
      mode: resultAreas?.method ?? "manual",
    },
  };
  const fallbackExecutiveView = useMemo(
    () => buildExecutiveFallback(fullResult, fteDeepView, resultAreas),
    [fullResult, fteDeepView, resultAreas]
  );
  const executiveView = fullResult?.ux_v2?.executive;
  const auditView = fullResult?.ux_v2?.audit;
  const topRisksView =
    Array.isArray(executiveView?.top_risks) && executiveView.top_risks.length > 0
      ? executiveView.top_risks
      : fallbackExecutiveView.top_risks;
  const criticalObligationsView = Array.isArray(executiveView?.critical_obligations)
    ? executiveView.critical_obligations.length > 0
      ? executiveView.critical_obligations
      : fallbackExecutiveView.critical_obligations
    : fallbackExecutiveView.critical_obligations;
  const coverageGapsView = Array.isArray(executiveView?.coverage_gaps)
    ? executiveView.coverage_gaps.length > 0
      ? executiveView.coverage_gaps
      : fallbackExecutiveView.coverage_gaps
    : fallbackExecutiveView.coverage_gaps;
  const fallbackFlagsView = Array.isArray(auditView?.fallback_flags)
    ? auditView.fallback_flags
    : (coverageGapsView.length > 0 ? coverageGapsView : []).map((item) => `fallback:${item}`);
  const inferredConfidenceMap = useMemo(() => {
    return evidenceView.reduce(
      (acc, item) => {
        const level = String(item?.confianca ?? "").toLowerCase();
        if (level === "alta" || level === "media" || level === "baixa") {
          acc[level] += 1;
        } else if (item?.status === "success") {
          acc.media += 1;
        } else {
          acc.baixa += 1;
        }
        return acc;
      },
      { alta: 0, media: 0, baixa: 0 }
    );
  }, [evidenceView]);
  const confidenceMapView = auditView?.confidence_map ?? inferredConfidenceMap;
  const actionPlanView = actionPlanItems.length
    ? actionPlanItems
    : (() => {
        const fromPayload = normalizeActionPlanItems(fullResult?.action_plan?.items ?? []);
        if (fromPayload.length > 0) return fromPayload;
        const fallbackTitles = [
          ...criticalObligationsView.map((item) => `Executar obrigação crítica: ${item}`),
          ...coverageGapsView.map((item) => `Mitigar lacuna: ${item}`),
        ];
        return buildFallbackActionPlan(fallbackTitles);
      })();
  const timelineView = fullResult?.orchestration?.steps ?? [];
  const sourcesView = fullResult?.sources ?? [];
  const decisionSummary =
    executiveView?.decision_summary ||
    `Risco agregado ${String(fullResult?.summary?.risk_level ?? "medio").toUpperCase()} com ${totalAlerts} alerta(s).`;
  const aiEvidenceTotal = confidenceMapView.alta + confidenceMapView.media + confidenceMapView.baixa;
  const aiHighEvidenceRatio = aiEvidenceTotal > 0 ? Math.round((confidenceMapView.alta / aiEvidenceTotal) * 100) : 0;
  const aiTrustLevel = aiHighEvidenceRatio >= 60 ? "alto" : aiHighEvidenceRatio >= 30 ? "medio" : "baixo";
  const aiTransparencySummary =
    aiEvidenceTotal > 0
      ? `Lastro IA ${aiTrustLevel.toUpperCase()} (${aiHighEvidenceRatio}% de evidências com confiança alta).`
      : "Lastro IA indisponível para esta execução.";
  const aiNarrativeView = removeMarkdownSyntax(resultAI?.narrative || "");
  const aiNarrativeParagraphs = useMemo(
    () =>
      aiNarrativeView
        .split(/\n{2,}/)
        .map((item) => item.trim())
        .filter(Boolean),
    [aiNarrativeView]
  );
  const aiUnavailableReason = useMemo(() => {
    const raw = String(resultAI?.reason ?? "").trim();
    if (!raw) return "motivo não informado";
    if (/\s/.test(raw)) return raw;
    return humanizeSourceReason(raw);
  }, [resultAI?.reason]);
  const aiTransparencyReasons = useMemo(() => {
    const reasons: string[] = [];
    if (aiEvidenceTotal === 0) {
      reasons.push("Não há evidências suficientes para calcular confiança.");
    } else {
      reasons.push(
        `Foram avaliadas ${aiEvidenceTotal} evidências: ${confidenceMapView.alta} alta, ${confidenceMapView.media} média e ${confidenceMapView.baixa} baixa confiança.`
      );
      if (confidenceMapView.baixa > confidenceMapView.alta) {
        reasons.push("A proporção de evidências de baixa confiança está maior que a de alta confiança.");
      }
    }
    if (!resultAI?.available) {
      reasons.push(`Resumo IA indisponível nesta execução (${aiUnavailableReason}).`);
    }
    if (fullResult?.persistence?.durable === false) {
      reasons.push("A análise atual está em cache de memória, sem persistência durável em banco.");
    }
    if (fallbackFlagsView.length > 0) {
      reasons.push(`Foram detectados ${fallbackFlagsView.length} fallback(s) em conectores/agentes nesta execução.`);
    }
    return reasons.slice(0, 4);
  }, [aiEvidenceTotal, confidenceMapView, resultAI?.available, aiUnavailableReason, fullResult?.persistence?.durable, fallbackFlagsView.length]);

  const openRagFindingDetails = (item: FteDeepAnalysis["findings"][number]) => {
    const refs = item.ftes_relacionadas.map((ref) => {
      const first = [ref.codigo, ref.titulo, ref.categoria].filter(Boolean).join(" | ");
      const second = [ref.justificativa, ref.trecho].filter(Boolean).join(" | ");
      return second ? `${first} -> ${second}` : first;
    });
    const links = dedupeDetailLinks([
      ...item.ftes_relacionadas
        .filter((ref) => Boolean(ref.url))
        .map((ref, index) => ({
          label: `FTE relacionada ${index + 1}${ref.codigo ? ` (${ref.codigo})` : ""}`,
          href: String(ref.url),
        })),
      ...(fullResult?.ibama?.link_consulta
        ? [
            {
              label: "Guia oficial de enquadramento (IBAMA)",
              href: fullResult.ibama.link_consulta,
            },
          ]
        : []),
    ]);

    setDetailPanelItem({
      kind: "rag",
      title: `CNAE ${item.cnae_codigo}`,
      subtitle: item.cnae_descricao || "Análise aprofundada CNAE x FTE",
      risk: item.risco,
      status: item.probabilidade_enquadramento,
      description: item.tese_enquadramento || "Sem tese textual detalhada nesta execução.",
      sections: [
        { title: "Obrigações sugeridas", items: item.obrigacoes },
        { title: "Riscos jurídicos", items: item.riscos_juridicos },
        { title: "Recomendações de ação", items: item.recomendacoes_acao },
        { title: "Lacunas de evidência", items: item.lacunas },
        { title: "FTEs relacionadas", items: refs },
      ],
      links,
      raw: item,
    });
  };

  const openIbamaDetails = (match: IbamaResult["matches"][number]) => {
    setDetailPanelItem({
      kind: "ibama",
      title: `Cat. ${match.categoria} - ${match.nome}`,
      subtitle: `CNAE ${match.cnae_match}${match.cnae_desc ? ` | ${match.cnae_desc}` : ""}`,
      risk: match.risco,
      status: "federal",
      description: match.obrigacao,
      sections: [
        { title: "Fundamento federal", items: [resultIBAMA?.nota || "Sem nota federal."] },
        { title: "Trilha de enquadramento", items: [`Categoria IBAMA: ${match.categoria}`, `Nome: ${match.nome}`] },
      ],
      links: dedupeDetailLinks([
        { label: "FTEs por categoria", href: match.link_fte },
        { label: "Tabela FTE", href: match.link_tabela },
        ...(resultIBAMA?.link_consulta ? [{ label: "Guia oficial de enquadramento", href: resultIBAMA.link_consulta }] : []),
      ]),
      raw: match,
    });
  };

  const openStateDetails = (match: NationalStateResult["details"]["matches"][number]) => {
    setDetailPanelItem({
      kind: "state",
      title: `Estadual - CNAE ${match.cnae}`,
      subtitle: match.descricao || match.tipo,
      risk: match.risco,
      status: resultState?.mode || "manual_required",
      description: match.obrigacao,
      sections: [
        { title: "Classificação", items: [`Tipo: ${match.tipo}`] },
        { title: "Legislação citada", items: match.legislacao || [] },
        { title: "Nota do agente estadual", items: [resultState?.nota || "Sem nota estadual."] },
      ],
      links: dedupeDetailLinks([
        ...(resultState?.details?.links?.atividades ? [{ label: "Atividades passiveis (CETESB)", href: resultState.details.links.atividades }] : []),
        ...(resultState?.details?.links?.tabela_atividades
          ? [{ label: "Tabela de atividades", href: resultState.details.links.tabela_atividades }]
          : []),
        ...(resultState?.details?.links?.portal_licenciamento
          ? [{ label: "Portal de licenciamento CETESB", href: resultState.details.links.portal_licenciamento }]
          : []),
      ]),
      raw: match,
    });
  };

  const openMunicipalDetails = (match: NationalMunicipalResult["details"]["matches"][number]) => {
    const legislacao = resultMunicipal?.details?.legislacao;
    setDetailPanelItem({
      kind: "municipal",
      title: `Municipal - CNAE ${match.cnae}`,
      subtitle: match.descricao,
      risk: match.risco,
      status: resultMunicipal?.mode || "manual_required",
      description: match.enquadramento,
      sections: [
        { title: "Competência", items: [match.competencia] },
        { title: "Nota do agente municipal", items: [resultMunicipal?.nota || "Sem nota municipal."] },
      ],
      links: dedupeDetailLinks([
        ...(legislacao?.lc140 ? [{ label: "LC 140/2011", href: legislacao.lc140 }] : []),
        ...(legislacao?.consema ? [{ label: "DN CONSEMA", href: legislacao.consema }] : []),
        ...(legislacao?.municipios_habilitados
          ? [{ label: "Municípios habilitados", href: legislacao.municipios_habilitados }]
          : []),
      ]),
      raw: match,
    });
  };

  const openAreaMatchDetails = (match: AreasContaminadasResult["matches"][number]) => {
    setDetailPanelItem({
      kind: "areas",
      title: `Territorial - ${match.empreendimento || "Empreendimento sem nome"}`,
      subtitle: `${match.layer_name} | estratégia ${match.strategy}`,
      risk: match.risco,
      status: resultAreas?.status || "unknown",
      description: `Score de aderência ${match.score.toFixed(2)} para o match ${match.match_id}.`,
      sections: [
        { title: "Classificação territorial", items: [`Classificação: ${match.classificacao || "-"}`, `Atividade: ${match.atividade || "-"}`] },
        {
          title: "Endereço e georreferência",
          items: [
            `Endereço: ${match.endereco || "-"}`,
            `Município: ${match.municipio || "-"}`,
            `CEP: ${match.cep || "-"}`,
            `Latitude: ${match.latitude ?? "-"}`,
            `Longitude: ${match.longitude ?? "-"}`,
          ],
        },
        {
          title: "Metadados da camada",
          items: [`Layer: ${match.layer_name} (${match.layer_id})`, `NIS: ${match.nis || "-"}`, `SIGLA_DG: ${match.sigla_dg || "-"}`],
        },
      ],
      links: dedupeDetailLinks([
        ...(resultAreas?.official_map_open_url ? [{ label: "Abrir mapa oficial", href: resultAreas.official_map_open_url }] : []),
        ...(resultAreas?.official_map_embed_url ? [{ label: "Abrir embed oficial", href: resultAreas.official_map_embed_url }] : []),
      ]),
      raw: match,
    });
  };

  const openEvidenceDetails = (item: NonNullable<EnvironmentalComplianceResult["evidence"]>[number]) => {
    setDetailPanelItem({
      kind: "evidence",
      title: `Evidência ${item.id}`,
      subtitle: `${item.agent} | ${item.jurisdiction}`,
      status: humanizeExecutionStatus(item.status),
      description: item.resumo,
      sections: [
        { title: "Fonte e regra", items: [`Fonte: ${item.source_name || item.source_id || "-"}`, `Rule ID: ${item.rule_id || "-"}`] },
        {
          title: "Regra aplicada",
          items: item.regra_aplicada
            ? [
                `Condição: ${item.regra_aplicada.condicao}`,
                `Severidade: ${item.regra_aplicada.severidade}`,
                `Obrigação: ${item.regra_aplicada.obrigacao_resultante}`,
                ...(item.regra_aplicada.base_legal || []).map((entry) => `Base legal: ${entry}`),
              ]
            : [],
        },
        { title: "Integridade", items: [`input_hash: ${item.input_hash}`, `output_hash: ${item.output_hash}`, `confiança: ${item.confianca}`] },
      ],
      raw: item,
    });
  };

  const openSourceDetails = (source: EnvironmentalComplianceResult["sources"][number]) => {
    setDetailPanelItem({
      kind: "source",
      title: source.name,
      subtitle: `Fonte ${source.id}`,
      status: humanizeSourceStatus(source.status),
      description: source.message || "Sem mensagem complementar.",
      sections: [
        {
          title: "Telemetria",
          items: [
            `Latência: ${source.latency_ms}ms`,
            `Motivo: ${humanizeSourceReason(source.status_reason)}`,
            `Evidências: ${source.evidence_count ?? "-"}`,
          ],
        },
      ],
      raw: source,
    });
  };

  return (
    <div
      className="min-h-screen bg-gradient-to-b from-slate-100 via-slate-50 to-white"
      style={{ fontFamily: "'Source Sans 3', 'Segoe UI', system-ui, -apple-system, sans-serif" }}
    >
      <div className="bg-gradient-to-r from-slate-950 via-slate-900 to-[#0f2f39] text-white border-b border-slate-800">
        <div className="max-w-6xl mx-auto px-6 py-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-lg bg-emerald-500/90 flex items-center justify-center text-xs font-semibold">ENV</div>
            <h1 className="text-2xl tracking-tight" style={{ fontFamily: "'Merriweather', 'Lora', serif", fontWeight: 700 }}>
              Compliance Ambiental Nacional
            </h1>
          </div>
          <p className="text-slate-300 text-sm">Motor auditável de licenciamento por CNPJ (federal, estadual, municipal e territorial).</p>

          <div className="mt-6 flex flex-col gap-3 lg:flex-row">
            <div className="flex-1 relative">
              <input
                type="text"
                value={cnpj}
                onChange={(event) => {
                  setCnpj(formatCNPJ(event.target.value));
                  setError(null);
                }}
                placeholder="Digite o CNPJ (ex: 03.171.752/0001-03)"
                className="w-full px-4 py-3 rounded-lg bg-slate-900/80 border border-slate-700 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent text-sm"
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !loading) handleRun();
                }}
              />
            </div>
            <button
              onClick={handleRun}
              disabled={loading || cleanCNPJ(cnpj).length !== 14}
              className="px-6 py-3 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 disabled:text-slate-500 text-white font-medium rounded-lg transition-colors text-sm whitespace-nowrap"
            >
              {loading ? "Analisando..." : "Rodar 7 agentes"}
            </button>
          </div>

          {fullResult && (
            <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="inline-flex rounded-lg border border-slate-700 overflow-hidden bg-slate-900/50">
                <button
                  type="button"
                  onClick={() => setMode("executive")}
                  className={`px-4 py-2 text-sm transition-colors ${
                    activeMode === "executive" ? "bg-slate-200 text-slate-900 font-semibold" : "text-slate-300 hover:bg-slate-800"
                  }`}
                >
                  Resumo Executivo
                </button>
                <button
                  type="button"
                  onClick={() => setMode("auditor")}
                  className={`px-4 py-2 text-sm transition-colors ${
                    activeMode === "auditor" ? "bg-slate-200 text-slate-900 font-semibold" : "text-slate-300 hover:bg-slate-800"
                  }`}
                >
                  Modo Auditor
                </button>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={downloadJsonExport}
                  className="inline-flex items-center gap-1 rounded-md border border-slate-600 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-800"
                >
                  Exportar JSON
                </button>
                <button
                  type="button"
                  onClick={openPdfExport}
                  disabled={!fullResult?.analysis_id}
                  className="inline-flex items-center gap-1 rounded-md border border-slate-600 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Exportar PDF
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {(loading || loadingSavedAnalysis) && (
        <div className="bg-white border-b border-gray-200">
          <div className="max-w-6xl mx-auto px-6 py-3">
            <div className="flex flex-wrap items-center gap-4 text-xs text-gray-500">
              {["CNPJ/CNAE", "RAG CNAE x FTE", "Federal", "Estadual", "Municipal", "Áreas Contam.", "Relatório IA"].map((label, index) => (
                <div key={label} className="flex items-center gap-1.5">
                  <div
                    className={`w-2 h-2 rounded-full ${
                      currentAgent > index + 1 ? "bg-emerald-500" : currentAgent === index + 1 ? "bg-amber-500 animate-pulse" : "bg-gray-300"
                    }`}
                  />
                  <span className={currentAgent === index + 1 ? "text-gray-900 font-medium" : ""}>{label}</span>
                </div>
              ))}
              {loadingSavedAnalysis && <span className="text-slate-700 font-medium">Reabrindo análise persistida...</span>}
            </div>
          </div>
        </div>
      )}

      <div className="max-w-6xl mx-auto px-6 py-6 space-y-4">
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-5 py-4 text-red-800 text-sm">
            <strong>Erro:</strong> {error}
          </div>
        )}

        {dadosCNPJ && currentAgent > 1 && (
          <div className="bg-white rounded-lg border border-gray-200 px-5 py-4 shadow-sm">
            <div className="flex justify-between items-start gap-4">
              <div>
                <h2 className="font-bold text-gray-900">{dadosCNPJ.razao_social}</h2>
                {dadosCNPJ.nome_fantasia && <p className="text-sm text-gray-500">{dadosCNPJ.nome_fantasia}</p>}
                <p className="text-xs text-gray-400 mt-1">{dadosCNPJ.endereco}</p>
                <p className="text-xs text-gray-400 mt-1">
                  Contexto: {fullResult?.jurisdiction_context?.municipio_nome || "-"} / {fullResult?.jurisdiction_context?.uf || "-"}
                </p>
              </div>
              <div className="text-right">
                <Badge type={dadosCNPJ.situacao?.toLowerCase().includes("ativa") ? "baixo" : "alto"}>{dadosCNPJ.situacao || "N/A"}</Badge>
                <p className="text-xs text-gray-400 mt-1">Fonte: {dadosCNPJ.source}</p>
                <p className="text-xs text-gray-400 mt-1">Versão da análise: {fullResult?.schema_version || "-"}</p>
                <p className="text-xs text-gray-400 mt-1">Histórico: {humanizePersistence(fullResult?.persistence?.mode, fullResult?.persistence?.durable)}</p>
              </div>
            </div>
            {currentAgent >= 8 && fullResult && (
              <div className="mt-3 pt-3 border-t border-gray-100 flex flex-wrap gap-4 text-sm">
                <div className="flex items-center gap-1.5">
                  <span className="text-gray-500">CNAEs:</span>
                  <span className="font-semibold">{dadosCNPJ.cnaes.length}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-gray-500">Alertas totais:</span>
                  <span className="font-semibold text-red-700">{totalAlerts}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-gray-500">Evidências:</span>
                  <span className="font-semibold">{evidenceView.length}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-gray-500">Risco:</span>
                  <Badge type={riskBadgeType(fullResult?.summary?.risk_level)}>{String(fullResult?.summary?.risk_level || "medio").toUpperCase()}</Badge>
                </div>
              </div>
            )}
          </div>
        )}

        {fullResult && fullResult.schema_version !== "br-v1" && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg px-5 py-4 text-amber-900 text-sm">
            Versão antiga de análise detectada ({fullResult.schema_version || "-"}). Alguns blocos avançados podem vir incompletos até atualizar o backend.
          </div>
        )}

        {activeMode === "executive" && fullResult && loading && (
          <div className="bg-white rounded-lg border border-slate-200 px-5 py-4 text-sm text-slate-700">
            Consolidando o Resumo Executivo com os 7 agentes. Aguarde o término da análise para os blocos finais.
          </div>
        )}

        {activeMode === "executive" && fullResult?.persistence?.durable === false && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg px-5 py-4 text-amber-900 text-sm">
            Persistência em cache de memória detectada. Para histórico durável entre reinícios, configure `DATABASE_URL` no backend.
          </div>
        )}

        {fullResult && activeMode === "executive" && currentAgent >= 8 && !loadingSavedAnalysis && (
          <>
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
              <div className="xl:col-span-2 bg-white rounded-lg border border-slate-200 shadow-sm p-5 space-y-3">
                <h3 className="text-sm font-semibold tracking-wide text-slate-700 uppercase">Decisão Agora</h3>
                <p className="text-sm text-slate-700">{decisionSummary}</p>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge type={riskBadgeType(fullResult?.summary?.risk_level)}>{String(fullResult?.summary?.risk_level || "medio").toUpperCase()}</Badge>
                  <Badge type="neutral">Alertas: {totalAlerts}</Badge>
                  <Badge type="neutral">Evidências: {evidenceView.length}</Badge>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                  <div className="rounded-md border border-slate-200 bg-slate-50 p-3 space-y-1">
                    <p className="font-semibold text-slate-700">Top 3 obrigações críticas</p>
                    {criticalObligationsView.length > 0 ? (
                      criticalObligationsView.slice(0, 3).map((item) => (
                        <p key={item} className="text-slate-600">
                          - {item}
                        </p>
                      ))
                    ) : (
                      <p className="text-slate-500">Sem obrigações críticas estruturadas nesta execução.</p>
                    )}
                  </div>
                  <div className="rounded-md border border-slate-200 bg-slate-50 p-3 space-y-1">
                    <p className="font-semibold text-slate-700">Top 3 lacunas de evidência</p>
                    {coverageGapsView.length > 0 ? (
                      coverageGapsView.slice(0, 3).map((item) => (
                        <p key={item} className="text-slate-600">
                          - {item}
                        </p>
                      ))
                    ) : (
                      <p className="text-slate-500">Sem lacunas críticas detectadas.</p>
                    )}
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-5 space-y-3">
                <h3 className="text-sm font-semibold tracking-wide text-slate-700 uppercase">Cobertura</h3>
                <div className="space-y-2 text-xs">
                  <p className="text-slate-700">Federal: {humanizeCoverageStatus(coverageView.federal.status)}</p>
                  <p className="text-slate-700">Estadual: {humanizeCoverageStatus(coverageView.state.status)}</p>
                  <p className="text-slate-700">Municipal: {humanizeCoverageStatus(coverageView.municipal.status)}</p>
                  <p className="text-slate-700">Territorial: {humanizeCoverageStatus(coverageView.ambiental_territorial.status)}</p>
                </div>
                {topRisksView.length > 0 && (
                  <div className="pt-2 border-t border-slate-100 space-y-1">
                    <p className="text-xs font-semibold text-slate-700">Top riscos</p>
                    {topRisksView.slice(0, 3).map((item, index) => (
                      <p key={`${item.title}-${index}`} className="text-xs text-slate-600">
                        {index + 1}. [{item.sphere}] {item.title}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
              <div className="xl:col-span-2 bg-white rounded-lg border border-slate-200 shadow-sm p-5 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold tracking-wide text-slate-700 uppercase">Plano de Ação</h3>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={startActionPlan}
                      disabled={actionPlanSaving || actionPlanView.length === 0}
                      className="inline-flex items-center rounded-md bg-slate-900 text-white text-xs px-3 py-1.5 hover:bg-slate-800 disabled:opacity-50"
                    >
                      Iniciar plano de ação
                    </button>
                    <button
                      type="button"
                      onClick={persistActionPlan}
                      disabled={actionPlanSaving || actionPlanView.length === 0}
                      className="inline-flex items-center rounded-md border border-slate-300 text-slate-700 text-xs px-3 py-1.5 hover:bg-slate-50 disabled:opacity-50"
                    >
                      {actionPlanSaving ? "Salvando..." : "Salvar alterações"}
                    </button>
                  </div>
                </div>

                {actionPlanMessage && (
                  <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">{actionPlanMessage}</div>
                )}

                <div className="space-y-2">
                  {actionPlanView.length > 0 ? (
                    actionPlanView.map((item) => (
                      <div key={item.id} className="rounded-md border border-slate-200 p-3 grid grid-cols-1 lg:grid-cols-12 gap-2 text-xs">
                        <div className="lg:col-span-5">
                          <p className="font-semibold text-slate-800">{item.title}</p>
                          {item.source_refs.length > 0 && <p className="text-slate-500 mt-1">Refs: {item.source_refs.join(", ")}</p>}
                        </div>
                        <div className="lg:col-span-2">
                          <select
                            value={item.priority}
                            onChange={(event) => updateActionPlanItem(item.id, { priority: event.target.value as ActionPlanPriority })}
                            className="w-full rounded-md border border-slate-300 px-2 py-1.5 bg-white"
                          >
                            <option value="alta">alta</option>
                            <option value="media">media</option>
                            <option value="baixa">baixa</option>
                          </select>
                        </div>
                        <div className="lg:col-span-2">
                          <input
                            type="text"
                            value={item.owner || ""}
                            onChange={(event) => updateActionPlanItem(item.id, { owner: event.target.value || null })}
                            placeholder="Responsável"
                            className="w-full rounded-md border border-slate-300 px-2 py-1.5"
                          />
                        </div>
                        <div className="lg:col-span-2">
                          <input
                            type="date"
                            value={item.due_date || ""}
                            onChange={(event) => updateActionPlanItem(item.id, { due_date: event.target.value || null })}
                            className="w-full rounded-md border border-slate-300 px-2 py-1.5"
                          />
                        </div>
                        <div className="lg:col-span-1">
                          <select
                            value={item.status}
                            onChange={(event) => updateActionPlanItem(item.id, { status: event.target.value as ActionPlanStatus })}
                            className="w-full rounded-md border border-slate-300 px-2 py-1.5 bg-white"
                          >
                            <option value="pendente">pendente</option>
                            <option value="em_andamento">em_andamento</option>
                            <option value="concluido">concluido</option>
                          </select>
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="text-xs text-slate-500">Plano de ação não disponível nesta execução.</p>
                  )}
                </div>
              </div>

              <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-5 space-y-3">
                <h3 className="text-sm font-semibold tracking-wide text-slate-700 uppercase">Confiabilidade do lastro IA</h3>
                <p className="text-xs text-slate-500 mb-1">
                  O percentual indica <strong>quanto das evidências</strong> (conectores/agentes) foi classificado com <strong>confiança alta</strong> — não é nível de risco. Quanto maior, mais lastro sólido para o relatório.
                </p>
                <p className="text-xs text-slate-700">{aiTransparencySummary}</p>
                {aiTransparencyReasons.length > 0 && (
                  <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 space-y-1">
                    {aiTransparencyReasons.map((reason) => (
                      <p key={reason}>- {reason}</p>
                    ))}
                  </div>
                )}
                {resultAI?.available ? (
                  <div className="max-h-80 overflow-auto rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 space-y-2">
                    {aiNarrativeParagraphs.length > 0 ? (
                      aiNarrativeParagraphs.map((paragraph, index) => (
                        <p key={`${paragraph.slice(0, 24)}-${index}`} className="leading-relaxed">
                          {paragraph}
                        </p>
                      ))
                    ) : (
                      <p className="text-slate-500">Sem conteúdo textual gerado.</p>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-amber-700">Resumo IA indisponível: {aiUnavailableReason}.</p>
                )}
                {fallbackFlagsView.length > 0 && (
                  <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    <p className="font-semibold mb-1">Alertas de bloqueio</p>
                    {fallbackFlagsView.slice(0, 6).map((item) => (
                      <p key={item}>- {item}</p>
                    ))}
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => setMode("auditor")}
                  className="inline-flex items-center rounded-md border border-slate-300 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
                >
                  Abrir relatório completo (visão 7 agentes)
                </button>
              </div>
            </div>

            {historyItems.length > 0 && (
              <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-5 space-y-3">
                <h3 className="text-sm font-semibold tracking-wide text-slate-700 uppercase">Histórico Recente</h3>
                <div className="space-y-2">
                  {historyItems.map((item) => (
                    <button
                      key={String(item.analysis_id)}
                      type="button"
                      onClick={() => navigate(`/compliance/${item.analysis_id}/executive`)}
                      className="w-full text-left rounded-md border border-slate-200 px-3 py-2 hover:bg-slate-50"
                    >
                      <p className="text-xs font-semibold text-slate-800">{item.razao_social || item.cnpj}</p>
                      <p className="text-xs text-slate-500">
                        {formatCNPJ(item.cnpj || "")} | risco: {String(item.risk_level || "-")} | {String(item.analyzed_at || "-")}
                      </p>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {activeMode === "auditor" && (
          <>
            {(dadosCNPJ || currentAgent === 1) && (
          <AgentCard number={1} title="Agente 1 - Consulta CNPJ e CNAEs" icon="A1" status={dadosCNPJ ? "success" : currentAgent === 1 ? "info" : "idle"}>
            {currentAgent === 1 && !dadosCNPJ && <Spinner />}
            {dadosCNPJ && (
              <div className="mt-3">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-gray-500 uppercase tracking-wider">
                        <th className="pb-2 pr-3">Código</th>
                        <th className="pb-2 pr-3">Descrição</th>
                        <th className="pb-2">Tipo</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {dadosCNPJ.cnaes.map((cnae) => (
                        <tr key={`${cnae.codigo}-${cnae.principal ? "p" : "s"}`} className="text-gray-700">
                          <td className="py-2 pr-3 font-mono text-xs">{cnae.codigo}</td>
                          <td className="py-2 pr-3 text-xs">{cnae.descricao || "-"}</td>
                          <td className="py-2">
                            <Badge type={cnae.principal ? "info" : "neutral"}>{cnae.principal ? "Principal" : "Secundário"}</Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {fullResult?.govbr_context && (
                  <div className="mt-3 text-xs rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sky-900">
                    gov.br contratos: {fullResult.govbr_context.found_records} registro(s) na consulta.
                  </div>
                )}
              </div>
            )}
          </AgentCard>
            )}

            {(resultFteDeep || fullResult || currentAgent >= 2) && (
          <AgentCard
            number={2}
            title="Agente 2 - Análise Profunda CNAE x FTE (RAG)"
            icon="A2"
            status={fteDeepView ? (fteDeepView.available ? "warning" : "info") : currentAgent === 2 ? "info" : "idle"}
          >
            {currentAgent === 2 && !fteDeepView && <Spinner />}
            {fteDeepView && (
              <div className="mt-3 space-y-3">
                {fteDeepView.available ? (
                  <>
                    {fteDeepView.executive_summary && (
                      <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-900">{fteDeepView.executive_summary}</div>
                    )}
                    <div className="flex flex-wrap gap-2 text-xs">
                      <Badge type="info">Findings: {fteDeepView.stats?.total_findings ?? 0}</Badge>
                      <Badge type="alto">Risco alto: {fteDeepView.stats?.high_risk_findings ?? 0}</Badge>
                      <Badge type="medio">Risco médio: {fteDeepView.stats?.medium_risk_findings ?? 0}</Badge>
                      <Badge type="baixo">Risco baixo: {fteDeepView.stats?.low_risk_findings ?? 0}</Badge>
                    </div>
                    <div className="space-y-2 max-h-80 overflow-auto pr-1">
                      {fteDeepView.findings.map((item) => (
                        <div key={`${item.cnae_codigo}-${item.principal ? "p" : "s"}`} className="bg-white rounded-lg border border-gray-200 px-4 py-3 text-xs">
                          <div className="flex items-center justify-between gap-2">
                            <p className="font-semibold text-gray-900">
                              {item.cnae_codigo} - {item.cnae_descricao || "CNAE sem descrição"}
                            </p>
                            <div className="flex items-center gap-2">
                              <Badge type={riskBadgeType(item.risco)}>{item.risco}</Badge>
                              <DetailActionButton onClick={() => openRagFindingDetails(item)} />
                            </div>
                          </div>
                          {item.tese_enquadramento && <p className="text-gray-600 mt-2">{item.tese_enquadramento}</p>}
                          {item.ftes_relacionadas.length > 0 && (
                            <p className="text-gray-500 mt-1">FTEs relacionadas: {item.ftes_relacionadas.map((fte) => fte.codigo || fte.titulo).filter(Boolean).join(", ")}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="space-y-3">
                    <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">
                      Análise RAG indisponível: {fteDeepView.reason || "motivo não informado"}.
                    </div>
                    <div className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 text-xs space-y-1 text-gray-700">
                      <p>
                        <strong>Diagnóstico:</strong>{" "}
                        {ragSource
                          ? `${humanizeSourceStatus(ragSource.status)} / ${humanizeSourceReason(ragSource.status_reason)}`
                          : "Fonte openai_fte_rag ausente na resposta desta execução."}
                      </p>
                      {ragSource?.message && <p>{ragSource.message}</p>}
                      <p>
                        <strong>Esperado para abrir este agente:</strong> `OPENAI_API_KEY` + `OPENAI_FTE_VECTOR_STORE_ID` + backend no schema `br-v1`.
                      </p>
                    </div>
                    {fteDeepView.findings.length > 0 && (
                      <>
                        <div className="flex flex-wrap gap-2 text-xs">
                          <Badge type="info">Fallback: {fteDeepView.stats?.total_findings ?? fteDeepView.findings.length} CNAE(s)</Badge>
                          <Badge type="alto">Risco alto: {fteDeepView.stats?.high_risk_findings ?? 0}</Badge>
                          <Badge type="medio">Risco médio: {fteDeepView.stats?.medium_risk_findings ?? 0}</Badge>
                          <Badge type="baixo">Risco baixo: {fteDeepView.stats?.low_risk_findings ?? 0}</Badge>
                        </div>
                        <div className="space-y-2 max-h-80 overflow-auto pr-1">
                          {fteDeepView.findings.map((item) => (
                            <div key={`${item.cnae_codigo}-${item.principal ? "p" : "s"}-fallback`} className="bg-white rounded-lg border border-gray-200 px-4 py-3 text-xs">
                              <div className="flex items-center justify-between gap-2">
                                <p className="font-semibold text-gray-900">
                                  {item.cnae_codigo} - {item.cnae_descricao || "CNAE sem descrição"}
                                </p>
                                <div className="flex items-center gap-2">
                                  <Badge type={riskBadgeType(item.risco)}>{item.risco}</Badge>
                                  <DetailActionButton onClick={() => openRagFindingDetails(item)} />
                                </div>
                              </div>
                              {item.tese_enquadramento && <p className="text-gray-600 mt-2">{item.tese_enquadramento}</p>}
                              {item.ftes_relacionadas.length > 0 && (
                                <p className="text-gray-500 mt-1">
                                  FTEs relacionadas: {item.ftes_relacionadas.map((fte) => fte.codigo || fte.titulo).filter(Boolean).join(", ")}
                                </p>
                              )}
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
          </AgentCard>
            )}

            {(resultIBAMA || currentAgent === 3) && (
          <AgentCard
            number={3}
            title="Agente 3 - Achados Federais"
            icon="A3"
            status={resultIBAMA ? (resultIBAMA.enquadrado ? "danger" : "success") : currentAgent === 3 ? "info" : "idle"}
          >
            {currentAgent === 3 && !resultIBAMA && <Spinner />}
            {resultIBAMA && (
              <div className="mt-3 space-y-3">
                {resultIBAMA.enquadrado ? (
                  <>
                    <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-800">
                      <strong>{resultIBAMA.matches.length} enquadramento(s)</strong> federal(is) identificado(s) no CTF/APP.
                    </div>
                    <div className="space-y-2">
                      {resultIBAMA.matches.map((match, index) => (
                        <div key={`${match.categoria}-${index}`} className="bg-white rounded-lg border border-gray-200 px-4 py-3 text-xs">
                          <div className="flex items-center justify-between gap-2">
                            <p className="font-semibold text-gray-900">
                              Cat. {match.categoria} - {match.nome}
                            </p>
                            <div className="flex items-center gap-2">
                              <Badge type={riskBadgeType(match.risco)}>{match.risco}</Badge>
                              <DetailActionButton onClick={() => openIbamaDetails(match)} />
                            </div>
                          </div>
                          <p className="text-gray-600 mt-1">
                            CNAE: {match.cnae_match} {match.cnae_desc ? `(${match.cnae_desc})` : ""}
                          </p>
                          <p className="text-gray-600 mt-1">{match.obrigacao}</p>
                          <div className="mt-2 flex flex-wrap gap-3">
                            <ExternalLink href={match.link_fte}>FTEs por Categoria</ExternalLink>
                            <ExternalLink href={match.link_tabela}>Tabela FTE</ExternalLink>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3 text-sm text-emerald-800">
                    Nenhum enquadramento federal direto por CNAE.
                  </div>
                )}
                {fullResult?.federal?.obligations?.length ? (
                  <div className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 text-xs space-y-1">
                    <p className="font-semibold text-gray-800">Obrigações federais sugeridas</p>
                    {fullResult?.federal?.obligations?.map((item) => (
                      <p key={item} className="text-gray-600">
                        - {item}
                      </p>
                    ))}
                  </div>
                ) : null}
                <p className="text-xs text-gray-400 italic">{resultIBAMA.nota}</p>
                <ExternalLink href={resultIBAMA.link_consulta}>Guia de enquadramento (IBAMA)</ExternalLink>
              </div>
            )}
          </AgentCard>
            )}

            {(resultState || currentAgent === 4) && (
          <AgentCard
            number={4}
            title={`Agente 4 - Regras Estaduais (${fullResult?.jurisdiction_context?.uf || "UF"})`}
            icon="A4"
            status={
              resultState
                ? resultState.mode === "api_ready"
                  ? resultState.details.enquadrado
                    ? "warning"
                    : "success"
                  : "info"
                : currentAgent === 4
                ? "info"
                : "idle"
            }
          >
            {currentAgent === 4 && !resultState && <Spinner />}
            {resultState && (
              <div className="mt-3 space-y-3">
                <div className="flex flex-wrap gap-2">
                  <Badge type={resultState.mode === "api_ready" ? "info" : "neutral"}>{humanizeCoverageMode(resultState.mode)}</Badge>
                  <Badge type={resultState.available ? "baixo" : "medio"}>
                    {resultState.available ? "Atualização automática ativa" : "Revisão manual necessária"}
                  </Badge>
                </div>
                <p className="text-sm text-gray-700">{resultState.nota}</p>
                {resultState.obligations.length > 0 && (
                  <div className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 text-xs space-y-1">
                    <p className="font-semibold text-gray-800">Obrigações estaduais</p>
                    {resultState.obligations.map((item) => (
                      <p key={item} className="text-gray-600">
                        - {item}
                      </p>
                    ))}
                  </div>
                )}

                {resultState.mode === "api_ready" ? (
                  <>
                    {resultState.details.nota_rmsp && (
                      <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-xs text-red-700">{resultState.details.nota_rmsp}</div>
                    )}
                    <div className="space-y-2">
                      {resultState.details.matches.map((match, index) => (
                        <div key={`${match.cnae}-${index}`} className="bg-white rounded-lg border border-gray-200 px-4 py-3 text-xs">
                          <div className="flex items-center justify-between gap-2">
                            <p className="font-mono text-gray-700">{match.cnae}</p>
                            <div className="flex items-center gap-2">
                              <Badge type={riskBadgeType(match.risco)}>{match.risco}</Badge>
                              <DetailActionButton onClick={() => openStateDetails(match)} />
                            </div>
                          </div>
                          <p className="text-gray-600 mt-1">{match.descricao || match.tipo}</p>
                          <p className="text-gray-500 mt-1">{match.obrigacao}</p>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="bg-sky-50 border border-sky-200 rounded-lg px-4 py-3 text-sm text-sky-900">
                    Fluxo estadual assistido: fonte oficial da UF sem conector estruturado nesta versão.
                  </div>
                )}
              </div>
            )}
          </AgentCard>
            )}

            {(resultMunicipal || currentAgent === 5) && (
          <AgentCard
            number={5}
            title={`Agente 5 - Regras Municipais (${fullResult?.jurisdiction_context?.municipio_nome || "Município"})`}
            icon="A5"
            status={
              resultMunicipal
                ? resultMunicipal.mode === "api_ready"
                  ? resultMunicipal.details.enquadrado
                    ? "warning"
                    : "success"
                  : "info"
                : currentAgent === 5
                ? "info"
                : "idle"
            }
          >
            {currentAgent === 5 && !resultMunicipal && <Spinner />}
            {resultMunicipal && (
              <div className="mt-3 space-y-3">
                <div className="flex flex-wrap gap-2">
                  <Badge type={resultMunicipal.mode === "api_ready" ? "info" : "neutral"}>{humanizeCoverageMode(resultMunicipal.mode)}</Badge>
                  <Badge type={resultMunicipal.available ? "baixo" : "medio"}>
                    {resultMunicipal.available ? "Atualização automática ativa" : "Revisão manual necessária"}
                  </Badge>
                </div>
                <p className="text-sm text-gray-700">{resultMunicipal.nota}</p>
                {resultMunicipal.obligations.length > 0 && (
                  <div className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 text-xs space-y-1">
                    <p className="font-semibold text-gray-800">Obrigações municipais</p>
                    {resultMunicipal.obligations.map((item) => (
                      <p key={item} className="text-gray-600">
                        - {item}
                      </p>
                    ))}
                  </div>
                )}

                {resultMunicipal.mode === "api_ready" ? (
                  <div className="space-y-2">
                    {resultMunicipal.details.matches.map((match, index) => (
                      <div key={`${match.cnae}-${index}`} className="bg-white rounded-lg border border-gray-200 px-4 py-3 text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <p className="font-mono text-gray-700">{match.cnae}</p>
                          <div className="flex items-center gap-2">
                            <Badge type={riskBadgeType(match.risco)}>{match.risco}</Badge>
                            <DetailActionButton onClick={() => openMunicipalDetails(match)} />
                          </div>
                        </div>
                        <p className="text-gray-600 mt-1">{match.descricao}</p>
                        <p className="text-gray-500 mt-1">{match.enquadramento}</p>
                        <p className="text-gray-400 mt-1">Competência: {match.competencia}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="bg-sky-50 border border-sky-200 rounded-lg px-4 py-3 text-sm text-sky-900">
                    Fluxo municipal assistido: manter checklist local com trilha de auditoria.
                  </div>
                )}
              </div>
            )}
          </AgentCard>
            )}

            {(resultAreas || currentAgent === 6) && (
          <AgentCard
            number={6}
            title="Agente 6 - Áreas Contaminadas"
            icon="A6"
            status={
              resultAreas
                ? resultAreas.status === "match_found"
                  ? "danger"
                  : resultAreas.method === "api_match"
                  ? "success"
                  : "info"
                : currentAgent === 6
                ? "info"
                : "idle"
            }
          >
            {currentAgent === 6 && !resultAreas && <Spinner />}
            {resultAreas && (
              <div className="mt-3 space-y-3">
                <div className="bg-sky-50 border border-sky-200 rounded-lg px-4 py-3 text-sm text-sky-900">{resultAreas.summary}</div>

                <div className="flex flex-wrap gap-2">
                  <Badge type={resultAreas.method === "api_match" ? "info" : "neutral"}>{humanizeAreasMethod(resultAreas.method, resultAreas.status)}</Badge>
                  <Badge type={resultAreas.matches.length > 0 ? "alto" : "baixo"}>Ocorrências encontradas: {resultAreas.matches.length}</Badge>
                  <Badge type="neutral">Situação: {resultAreas.status === "match_found" ? "Com correspondência" : "Sem correspondência automática"}</Badge>
                </div>

                {areaLayers.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {areaLayers.map((layer) => (
                      <span key={layer} className="px-2 py-1 rounded-md text-xs bg-gray-100 text-gray-700 border border-gray-200">
                        {layer}
                      </span>
                    ))}
                  </div>
                )}

                {resultAreas.matches.length > 0 && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-left text-gray-500 uppercase tracking-wide">
                          <th className="pb-2 pr-3">Empreendimento</th>
                          <th className="pb-2 pr-3">Layer</th>
                          <th className="pb-2 pr-3">Estratégia</th>
                          <th className="pb-2 pr-3">Score</th>
                          <th className="pb-2 pr-3">Risco</th>
                          <th className="pb-2">Município</th>
                          <th className="pb-2">Detalhe</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {resultAreas.matches.map((match) => (
                          <tr key={match.match_id}>
                            <td className="py-2 pr-3">{match.empreendimento || "-"}</td>
                            <td className="py-2 pr-3">{match.layer_name}</td>
                            <td className="py-2 pr-3">{match.strategy}</td>
                            <td className="py-2 pr-3">{match.score.toFixed(2)}</td>
                            <td className="py-2 pr-3">
                              <Badge type={riskBadgeType(match.risco)}>{match.risco}</Badge>
                            </td>
                            <td className="py-2">{match.municipio || "-"}</td>
                            <td className="py-2">
                              <DetailActionButton onClick={() => openAreaMatchDetails(match)} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {capturingAreas && (
                  <div className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 text-xs text-gray-600">
                    Robô capturando screenshot automatizado do mapa oficial...
                  </div>
                )}

                {resultAreasCapture && (
                  <div className="bg-white border border-gray-200 rounded-lg px-4 py-3 space-y-2">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <Badge type={resultAreasCapture.status === "success" ? "baixo" : "medio"}>{humanizeSourceStatus(resultAreasCapture.status)}</Badge>
                      <span className="text-gray-500">motivo: {humanizeSourceReason(resultAreasCapture.status_reason)}</span>
                      <span className="text-gray-500">latência: {resultAreasCapture.latency_ms}ms</span>
                      <span className="text-gray-500">bytes: {resultAreasCapture.bytes}</span>
                    </div>
                    {resultAreasCapture.message && <p className="text-xs text-gray-600">{resultAreasCapture.message}</p>}
                    {resultAreasCapture.image_base64 && (
                      <img
                        src={`data:${resultAreasCapture.mime_type};base64,${resultAreasCapture.image_base64}`}
                        alt="Screenshot automatizado do mapa de areas contaminadas"
                        className="w-full rounded-md border border-gray-200"
                      />
                    )}
                  </div>
                )}

                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    disabled={capturingAreas}
                    onClick={() =>
                      runAreasCapture({
                        mapUrl: resultAreas.official_map_open_url || SEMIL_MAP_URL,
                        razaoSocial: String(dadosCNPJ?.razao_social ?? dadosCNPJ?.nome_fantasia ?? ""),
                        cnpj: String(dadosCNPJ?.cnpj ?? cleanCNPJ(cnpj)),
                      })
                    }
                    className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {capturingAreas ? "Capturando print..." : "Gerar/Regerar print"}
                  </button>
                  <ExternalLink href={resultAreas.official_map_open_url}>Abrir portal oficial</ExternalLink>
                </div>

                {resultAreas.evidence_refs.length > 0 && (
                  <p className="text-xs text-gray-500">Refs de evidência territorial: {resultAreas.evidence_refs.join(", ")}</p>
                )}

                {resultAreas.official_map_embed_url && (
                  <div className="rounded-lg border border-gray-200 overflow-hidden">
                    <iframe
                      title="Mapa oficial de areas contaminadas"
                      src={resultAreas.official_map_embed_url}
                      className="w-full h-[420px] bg-white"
                      loading="lazy"
                    />
                  </div>
                )}

                {resultAreas.limitations.length > 0 && (
                  <div className="text-xs text-gray-500 space-y-1">
                    {resultAreas.limitations.map((item) => (
                      <p key={item}>- {item}</p>
                    ))}
                  </div>
                )}
              </div>
            )}
          </AgentCard>
            )}

            {(resultAI || currentAgent === 7) && (
          <AgentCard
            number={7}
            title="Agente 7 - Relatório IA Auditável"
            icon="A7"
            status={resultAI ? (resultAI.available ? "success" : "warning") : currentAgent === 7 ? "info" : "idle"}
          >
            {currentAgent === 7 && !resultAI && <Spinner />}
            {resultAI && (
              <div className="mt-3 space-y-3">
                {resultAI.available ? (
                  <>
                    <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3 text-sm text-emerald-800">
                      Relatório IA gerado com base nas evidências estruturadas.
                    </div>
                    <p className="text-xs text-gray-500">
                      Modelo: {resultAI.model || "N/A"} | Tokens in: {resultAI.input_tokens ?? "-"} | Tokens out: {resultAI.output_tokens ?? "-"}
                    </p>
                    <div className="max-h-96 overflow-auto rounded-md border border-gray-200 bg-white px-4 py-3 text-sm text-gray-700 space-y-2">
                      {aiNarrativeParagraphs.length > 0 ? (
                        aiNarrativeParagraphs.map((paragraph, index) => (
                          <p key={`${paragraph.slice(0, 24)}-${index}`} className="leading-relaxed">
                            {paragraph}
                          </p>
                        ))
                      ) : (
                        <p className="text-gray-500">Sem conteúdo textual.</p>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">
                    Relatório IA indisponivel: {aiUnavailableReason}
                  </div>
                )}
              </div>
            )}
          </AgentCard>
            )}

            {fullResult && (
          <div className="bg-white rounded-lg border border-gray-200 px-5 py-4 shadow-sm space-y-4">
            <h3 className="font-semibold text-gray-900">Cobertura Nacional</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 text-xs">
              <div className="border border-gray-200 rounded-md px-3 py-2">
                <p className="font-semibold text-gray-800">Federal</p>
                <p className="text-gray-600 mt-1">{humanizeCoverageStatus(coverageView.federal.status)}</p>
                <p className="text-gray-500 mt-1">{humanizeCoverageMode(coverageView.federal.mode)}</p>
              </div>
              <div className="border border-gray-200 rounded-md px-3 py-2">
                <p className="font-semibold text-gray-800">Estadual</p>
                <p className="text-gray-600 mt-1">{humanizeCoverageStatus(coverageView.state.status)}</p>
                <p className="text-gray-500 mt-1">{humanizeCoverageMode(coverageView.state.mode)}</p>
              </div>
              <div className="border border-gray-200 rounded-md px-3 py-2">
                <p className="font-semibold text-gray-800">Municipal</p>
                <p className="text-gray-600 mt-1">{humanizeCoverageStatus(coverageView.municipal.status)}</p>
                <p className="text-gray-500 mt-1">{humanizeCoverageMode(coverageView.municipal.mode)}</p>
              </div>
              <div className="border border-gray-200 rounded-md px-3 py-2">
                <p className="font-semibold text-gray-800">Territorial</p>
                <p className="text-gray-600 mt-1">{humanizeCoverageStatus(coverageView.ambiental_territorial.status)}</p>
                <p className="text-gray-500 mt-1">{humanizeCoverageMode(coverageView.ambiental_territorial.mode)}</p>
              </div>
            </div>
          </div>
            )}

            {fullResult && (
          <div className="bg-white rounded-lg border border-gray-200 px-5 py-4 shadow-sm space-y-4">
            <h3 className="font-semibold text-gray-900">Modo Auditoria</h3>

            <div>
              <p className="text-xs font-semibold text-gray-700 mb-2">Evidências normalizadas</p>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-gray-500 uppercase tracking-wide">
                      <th className="pb-2 pr-3">Agente</th>
                      <th className="pb-2 pr-3">Jurisdição</th>
                      <th className="pb-2 pr-3">Fonte</th>
                      <th className="pb-2 pr-3">Regra</th>
                      <th className="pb-2 pr-3">Status</th>
                      <th className="pb-2 pr-3">Confiança</th>
                      <th className="pb-2">Resumo</th>
                      <th className="pb-2">Detalhe</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {evidenceView.map((item) => (
                      <tr key={item.id}>
                        <td className="py-2 pr-3 font-mono">{item.agent}</td>
                        <td className="py-2 pr-3">{item.jurisdiction}</td>
                        <td className="py-2 pr-3">{item.source_name || item.source_id || "-"}</td>
                        <td className="py-2 pr-3">{item.rule_id || "-"}</td>
                        <td className="py-2 pr-3">{humanizeExecutionStatus(item.status)}</td>
                        <td className="py-2 pr-3">{item.confianca}</td>
                        <td className="py-2">{item.resumo || "-"}</td>
                        <td className="py-2">
                          <DetailActionButton onClick={() => openEvidenceDetails(item)} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold text-gray-700 mb-2">Fontes consultadas</p>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-gray-500 uppercase tracking-wide">
                      <th className="pb-2 pr-3">Fonte</th>
                      <th className="pb-2 pr-3">Status</th>
                      <th className="pb-2 pr-3">Motivo</th>
                      <th className="pb-2 pr-3">Latencia</th>
                      <th className="pb-2 pr-3">Evidencias</th>
                      <th className="pb-2">Mensagem</th>
                      <th className="pb-2">Detalhe</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {sourcesView.map((source) => (
                      <tr key={source.id}>
                        <td className="py-2 pr-3">{source.name}</td>
                        <td className="py-2 pr-3">
                          <Badge type={source.status === "success" ? "baixo" : source.status === "not_found" ? "neutral" : "medio"}>
                            {humanizeSourceStatus(source.status)}
                          </Badge>
                        </td>
                        <td className="py-2 pr-3">{humanizeSourceReason(source.status_reason)}</td>
                        <td className="py-2 pr-3">{source.latency_ms}ms</td>
                        <td className="py-2 pr-3">{source.evidence_count ?? "-"}</td>
                        <td className="py-2">{source.message || "-"}</td>
                        <td className="py-2">
                          <DetailActionButton onClick={() => openSourceDetails(source)} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold text-gray-700 mb-2">Timeline dos 7 agentes</p>
              <div className="space-y-2">
                {timelineView.map((step) => (
                  <div key={step.agent} className="border border-gray-200 rounded-md px-3 py-2 text-xs">
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-semibold text-gray-800">{step.title}</p>
                      <Badge type={step.status === "completed" ? "baixo" : step.status === "failed" ? "alto" : "info"}>
                        {humanizeExecutionStatus(step.status)}
                      </Badge>
                    </div>
                    <p className="text-gray-600 mt-1">{step.message || "-"}</p>
                    <p className="text-gray-400 mt-1">
                      início: {step.started_at || "-"} | fim: {step.completed_at || "-"}
                    </p>
                  </div>
                ))}
              </div>
            </div>

          </div>
            )}
          </>
        )}

        {!dadosCNPJ && !loading && !loadingSavedAnalysis && !error && (
          <div className="text-center py-16 text-gray-400">
            <p className="text-3xl mb-4 font-semibold">AGENTES</p>
            <p className="text-sm">Digite um CNPJ para iniciar a verificação de compliance ambiental.</p>
          </div>
        )}

        {currentAgent >= 8 && fullResult && (
          <div className="bg-gray-800 text-white rounded-lg px-5 py-4 text-xs space-y-1">
            <p className="font-semibold text-sm mb-2">Disclaimer</p>
            {(fullResult.disclaimers || []).map((item) => (
              <p key={item}>{item}</p>
            ))}
          </div>
        )}

        <EnvironmentalDetailSheet
          open={Boolean(detailPanelItem)}
          onOpenChange={(open) => {
            if (!open) setDetailPanelItem(null);
          }}
          item={detailPanelItem}
        />
      </div>
    </div>
  );
}
