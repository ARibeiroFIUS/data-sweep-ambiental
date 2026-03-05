export interface EnvironmentalCnae {
  codigo: string;
  descricao: string;
  principal: boolean;
}

export interface EnvironmentalCompany {
  razao_social: string;
  nome_fantasia: string;
  cnpj: string;
  situacao: string;
  endereco: string;
  municipio?: string;
  uf?: string;
  bairro?: string;
  logradouro?: string;
  numero?: string;
  cep?: string;
  cnaes: EnvironmentalCnae[];
  source: string;
}

export interface EnvironmentalSource {
  id: string;
  name: string;
  status: "success" | "error" | "not_found" | "unavailable";
  latency_ms: number;
  status_reason: string;
  evidence_count?: number;
  message?: string;
}

export interface FteCitation {
  file_id: string | null;
  filename: string | null;
  quote?: string;
}

export interface FteDeepReference {
  codigo?: string;
  titulo?: string;
  categoria?: string;
  cnaes?: string[];
  justificativa?: string;
  url?: string;
  trecho?: string;
}

export interface FteDeepFinding {
  cnae_codigo: string;
  cnae_descricao: string;
  principal: boolean;
  risco: "alto" | "medio" | "baixo" | "nao_classificado";
  probabilidade_enquadramento: "alta" | "media" | "baixa" | "indefinida";
  tese_enquadramento: string | null;
  obrigacoes: string[];
  riscos_juridicos: string[];
  recomendacoes_acao: string[];
  lacunas: string[];
  ftes_relacionadas: FteDeepReference[];
}

export interface FteDeepAnalysis {
  available: boolean;
  reason?: string;
  executive_summary?: string;
  findings: FteDeepFinding[];
  overall_recommendations?: string[];
  legal_risks?: string[];
  citations?: FteCitation[];
  model?: string;
  vector_store_id?: string;
  input_tokens?: number;
  output_tokens?: number;
  generated_at?: string;
  parse_warning?: string;
  stats?: {
    total_findings: number;
    high_risk_findings: number;
    medium_risk_findings: number;
    low_risk_findings: number;
  };
}

export interface IbamaMatch {
  categoria: number;
  nome: string;
  cnae_match: string;
  cnae_desc: string;
  link_fte: string;
  link_tabela: string;
  obrigacao: string;
  risco: "alto" | "medio" | "baixo";
}

export interface IbamaResult {
  enquadrado: boolean;
  matches: IbamaMatch[];
  nota: string;
  link_consulta: string;
}

export interface CetesbMatch {
  cnae: string;
  descricao: string;
  tipo: string;
  obrigacao: string;
  risco: "alto" | "medio" | "baixo";
  legislacao: string[];
}

export interface CetesbResult {
  enquadrado: boolean;
  matches: CetesbMatch[];
  lp_precedente: boolean;
  rmsp_restricoes: boolean;
  nota_rmsp: string | null;
  links: {
    atividades: string;
    tabela_atividades: string;
    portal_licenciamento: string;
  };
}

export interface MunicipalMatch {
  cnae: string;
  descricao: string;
  enquadramento: string;
  competencia: string;
  risco: "alto" | "medio" | "baixo";
}

export interface MunicipalLegacyResult {
  enquadrado: boolean;
  matches: MunicipalMatch[];
  legislacao: {
    lc140: string;
    consema: string;
    municipios_habilitados: string;
  };
  nota: string;
}

export interface AreaMatch {
  match_id: string;
  layer_id: number;
  layer_name: string;
  strategy: string;
  score: number;
  risco: "alto" | "medio" | "baixo";
  empreendimento: string | null;
  atividade: string | null;
  classificacao: string | null;
  endereco: string | null;
  municipio: string | null;
  cep: string | null;
  nis: string | null;
  sigla_dg: string | null;
  latitude: number | null;
  longitude: number | null;
}

export interface AreasContaminadasResult {
  available: boolean;
  method: "api_match" | "dataset_match" | "manual_required";
  status: string;
  summary: string;
  matches: AreaMatch[];
  official_map_embed_url: string;
  official_map_open_url: string;
  evidence_refs: string[];
  limitations: string[];
}

export interface AreasContaminadasScreenshotCapture {
  available: boolean;
  status: "success" | "error";
  status_reason: string;
  message?: string;
  map_url: string;
  file_name: string | null;
  file_path: string | null;
  mime_type: string;
  bytes: number;
  image_base64: string | null;
  captured_at: string;
  latency_ms: number;
}

export interface NationalStateResult {
  scope: "estadual";
  uf: string | null;
  mode: "api_ready" | "manual_required";
  source_id: string;
  available: boolean;
  details: CetesbResult;
  obligations: string[];
  nota: string;
}

export interface NationalMunicipalResult {
  scope: "municipal";
  uf: string | null;
  municipio_nome: string | null;
  mode: "api_ready" | "manual_required";
  source_id: string;
  available: boolean;
  details: MunicipalLegacyResult;
  obligations: string[];
  nota: string;
}

export interface GovBrContractSample {
  numero: string | null;
  modalidade: string | null;
  orgao: string | null;
  municipio: string | null;
  valor: number;
}

export interface GovBrContext {
  consulted: boolean;
  found_records: number;
  sample: GovBrContractSample[];
}

export interface FederalResult {
  scope: "federal";
  ibama: IbamaResult;
  fte_rag: {
    available: boolean;
    stats: FteDeepAnalysis["stats"] | null;
    overall_recommendations: string[];
  };
  govbr_context: GovBrContext | null;
  obligations: string[];
}

export interface EvidenceRuleApplied {
  base_legal: string[];
  condicao: string;
  severidade: string;
  obrigacao_resultante: string;
}

export interface EvidenceRecord {
  id: string;
  at: string;
  agent: string;
  source_id: string | null;
  source_name: string | null;
  jurisdiction: string;
  rule_id: string | null;
  regra_aplicada: EvidenceRuleApplied | null;
  status: string;
  confianca: "alta" | "media" | "baixa";
  resumo: string;
  input_hash: string;
  output_hash: string;
}

export interface JurisdictionContext {
  uf: string | null;
  municipio_ibge: string | null;
  municipio_nome: string | null;
  scope_mode: "national";
}

export interface CoverageSphere {
  status: "api_ready" | "manual_required";
  mode: string;
  sources: string[];
}

export interface CoverageMatrix {
  scope_mode: "national";
  jurisdiction: {
    uf: string | null;
    municipio_ibge: string | null;
    municipio_nome: string | null;
  };
  federal: CoverageSphere;
  state: CoverageSphere;
  municipal: CoverageSphere;
  ambiental_territorial: CoverageSphere;
}

export interface EnvironmentalSummary {
  total_alerts: number;
  fte_alerts: number;
  ibama_alerts: number;
  state_alerts: number;
  municipal_alerts: number;
  areas_alerts: number;
  cetesb_alerts: number;
  by_sphere: {
    federal: number;
    estadual: number;
    municipal: number;
    ambiental_territorial: number;
  };
  coverage_status: {
    federal: string | null;
    state: string | null;
    municipal: string | null;
    ambiental_territorial: string | null;
  };
  risk_level: "baixo" | "medio" | "alto";
}

export interface ExecutiveTopRisk {
  sphere: "federal" | "estadual" | "municipal" | "ambiental_territorial" | string;
  severity: "alto" | "medio" | "baixo" | string;
  title: string;
  detail: string;
}

export interface EnvironmentalUxV2 {
  executive: {
    decision_summary: string;
    critical_obligations: string[];
    coverage_gaps: string[];
    top_risks: ExecutiveTopRisk[];
  };
  audit: {
    confidence_map: {
      alta: number;
      media: number;
      baixa: number;
    };
    evidence_index: {
      total: number;
      by_agent: Record<string, number>;
      by_source: Record<string, number>;
    };
    fallback_flags: string[];
  };
}

export type ActionPlanStatus = "pendente" | "em_andamento" | "concluido";
export type ActionPlanPriority = "alta" | "media" | "baixa";

export interface EnvironmentalActionPlanItem {
  id: string;
  title: string;
  priority: ActionPlanPriority;
  owner: string | null;
  due_date: string | null;
  status: ActionPlanStatus;
  source_refs: string[];
}

export interface EnvironmentalActionPlan {
  items: EnvironmentalActionPlanItem[];
}

export interface EnvironmentalAiReport {
  available: boolean;
  narrative?: string;
  model?: string;
  reason?: string;
  input_tokens?: number;
  output_tokens?: number;
  generated_at?: string;
}

export interface OrchestrationStep {
  agent: string;
  title: string;
  status: "pending" | "running" | "completed" | "failed";
  started_at: string | null;
  completed_at: string | null;
  message?: string;
  summary?: Record<string, unknown>;
}

export interface OrchestrationEvent {
  seq: number;
  at: string;
  agent: string;
  status: "running" | "completed" | "failed";
  message: string;
  payload?: Record<string, unknown>;
}

export interface EnvironmentalOrchestration {
  version: string;
  status: "running" | "completed" | "failed";
  started_at: string;
  completed_at: string | null;
  input: { cnpj: string };
  steps: OrchestrationStep[];
  events: OrchestrationEvent[];
}

export interface EnvironmentalComplianceResult {
  schema_version: "br-v1" | string;
  analysis_id?: string;
  persistence?: {
    mode: "database" | "memory_cache";
    durable: boolean;
    database_configured: boolean;
  };
  cache?: {
    reused: boolean;
    source: "database" | "memory_cache" | "none";
    reuse_window_days: number;
    previous_analysis_id: string | null;
    previous_analyzed_at: string | null;
    age_days: number | null;
    forced_refresh?: boolean;
    message?: string | null;
  };
  cnpj: string;
  jurisdiction_context: JurisdictionContext;
  company: EnvironmentalCompany;
  federal: FederalResult;
  state: NationalStateResult;
  municipal: NationalMunicipalResult;
  areas_contaminadas: AreasContaminadasResult;
  coverage: CoverageMatrix;
  evidence: EvidenceRecord[];
  source_catalog?: Record<string, unknown>;
  rule_catalog?: Record<string, unknown>;
  fte_deep_analysis: FteDeepAnalysis;
  ibama: IbamaResult;
  cetesb: CetesbResult;
  municipal_legacy?: MunicipalLegacyResult;
  ai_report: EnvironmentalAiReport;
  ux_v2?: EnvironmentalUxV2;
  action_plan?: EnvironmentalActionPlan;
  govbr_context: GovBrContext | null;
  summary: EnvironmentalSummary;
  orchestration: EnvironmentalOrchestration;
  disclaimers: string[];
  sources: EnvironmentalSource[];
  analyzed_at: string;
}
