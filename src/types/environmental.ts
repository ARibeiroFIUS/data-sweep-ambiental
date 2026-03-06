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
  status: "success" | "error" | "not_found" | "unavailable" | "partial" | "manual_required" | "not_applicable";
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

export interface CetesbLicencaPublicaCompanyMatch {
  match_id: string;
  candidate_url: string;
  razao_social: string | null;
  municipio: string | null;
  logradouro: string | null;
  cnpj: string | null;
  score: number;
  match_level: "alto" | "medio" | "baixo" | "sem_match";
  criteria: {
    cnpj_exact: boolean;
    razao_social_match: boolean;
    municipio_match: boolean;
    logradouro_match: boolean;
  };
  licenses_count: number;
}

export interface CetesbLicencaPublica {
  sd_numero: string | null;
  data_sd: string | null;
  numero_processo: string | null;
  objeto_solicitacao: string | null;
  numero_documento: string | null;
  situacao: string | null;
  desde: string | null;
  documento_autenticidade_url: string | null;
  match_id?: string;
}

export interface CetesbLicencasPublicasResult {
  available: boolean;
  method: "portal_connector" | "not_applicable" | string;
  query: {
    cnpj: string | null;
    uf: string | null;
    razao_social?: string | null;
    municipio?: string | null;
  };
  company_matches: CetesbLicencaPublicaCompanyMatch[];
  licenses: CetesbLicencaPublica[];
  official_links: {
    consulta_url: string;
    resultado_url: string;
    autenticidade_base_url: string;
  };
  evidence_refs: string[];
  limitations: string[];
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

export interface SanitarioCoverageItem {
  status: "api_ready" | "portal" | "manual_required" | string;
  mode: string;
  source_id: string;
  label?: string;
}

export interface SanitarioFinding {
  finding_id: string;
  cnae_codigo: string;
  cnae_descricao: string;
  principal: boolean;
  tema: string;
  risco: "alto" | "medio" | "baixo" | string;
  trigger_strategy: string;
  obrigacoes: string[];
  esferas: string[];
}

export interface SanitarioResult {
  available: boolean;
  status: "triggered" | "not_triggered" | string;
  federal: SanitarioCoverageItem & { checklist: string[] };
  state: SanitarioCoverageItem & { checklist: string[] };
  municipal: SanitarioCoverageItem & { checklist: string[] };
  findings: SanitarioFinding[];
  obrigacoes: string[];
  official_links: {
    federal: string[];
    state: string[];
    municipal: string[];
  };
  coverage: {
    federal: SanitarioCoverageItem;
    state: SanitarioCoverageItem;
    municipal: SanitarioCoverageItem;
  };
  evidence_refs: string[];
  limitations: string[];
}

export interface SeiPublicoProvider {
  provider_id: string;
  name: string;
  status: "success" | "not_found" | "manual_required" | "unavailable" | string;
  status_reason: string;
  query_url: string;
}

export interface SeiPublicoQuery {
  kind: "razao_social" | "cnpj" | string;
  value: string;
}

export interface SeiPublicoLink {
  provider_id: string;
  label: string;
  url: string;
  query: string | null;
}

export interface SeiPublicoProcesso {
  result_id: string;
  provider_id: string;
  provider_name: string;
  numero_processo: string;
  orgao: string | null;
  assunto: string | null;
  data: string | null;
  link: string;
}

export interface SeiPublicoResult {
  available: boolean;
  method: "assistido_auditavel" | "manual_required" | string;
  providers: SeiPublicoProvider[];
  queries: SeiPublicoQuery[];
  links: SeiPublicoLink[];
  results: SeiPublicoProcesso[];
  status_reason: string;
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
  cetesb_licencas_alerts?: number;
  municipal_alerts: number;
  areas_alerts: number;
  sanitario_alerts?: number;
  sei_alerts?: number;
  cetesb_alerts: number;
  by_sphere: {
    federal: number;
    estadual: number;
    municipal: number;
    ambiental_territorial: number;
    sanitario?: number;
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
  cetesb_licencas_publicas?: CetesbLicencasPublicasResult;
  municipal: NationalMunicipalResult;
  areas_contaminadas: AreasContaminadasResult;
  sanitario?: SanitarioResult;
  sei_publico?: SeiPublicoResult;
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
