export interface CompanyData {
  cnpj: string;
  razao_social: string;
  nome_fantasia: string;
  situacao_cadastral: string;
  data_situacao_cadastral: string;
  data_inicio_atividade: string;
  cnae_fiscal: number;
  cnae_fiscal_descricao: string;
  logradouro: string;
  numero: string;
  complemento: string;
  bairro: string;
  cep: string;
  municipio: string;
  uf: string;
  natureza_juridica: string;
  porte: string;
  capital_social: number;
  qsa: Partner[];
}

export interface Partner {
  nome: string;
  qual: string;
  pais_origem: string;
  nome_rep_legal: string;
  qual_rep_legal: string;
  faixa_etaria: string;
  cnpj_cpf_do_socio?: string;
  tipo?: string;
}

export interface RiskFlag {
  id: string;
  source: string;
  severity: "low" | "medium" | "high" | "critical";
  title: string;
  description: string;
  weight: number;
  evidence?: Array<{
    label: string;
    value: string;
  }>;
  /** Score de desambiguação 0.0–1.0 (spec Layer 5) — presente em flags de sócios PF por nome */
  confidence?: number;
  /** Nível de confiança da desambiguação — ausente em flags de dados objetivos */
  confidence_level?: "CONFIRMADO" | "PROVAVEL" | "POSSIVEL";
  /** Profundidade na rede societária: 0=empresa principal, 1=sócio direto, 2=sócio do sócio */
  depth?: number;
  /** Política de confiabilidade da flag para pontuação e exibição */
  verification_status?: "objective" | "probable" | "possible";
}

export interface DataSource {
  id?: string;
  name: string;
  status: "success" | "error" | "not_found" | "unavailable" | "running";
  message?: string;
  status_reason?: string;
  latency_ms?: number;
  evidence_count?: number;
}

export interface AiAnalysis {
  available: boolean;
  /** Laudo investigativo em prosa dividido em 3 seções */
  narrative?: string;
  model?: string;
  reason?: string;
  input_tokens?: number;
  output_tokens?: number;
}

export interface PartnerCompanyItem {
  partner_name: string;
  cnpj: string;
  razao_social: string;
  nome_fantasia: string;
  situacao_cadastral: string;
  uf: string;
  municipio: string;
  data_inicio_atividade: string;
  cep?: string;
  /** Flags de risco do sócio PJ investigado (Agente 2) */
  risk_flags?: Array<{ id: string; title: string; severity: string; weight: number }>;
  risk_score?: number;
  risk_classification?: string;
}

export interface ProcessoAndamento {
  dataHora: string | null;
  nome: string;
  complemento: string | null;
}

export interface JudicialProcess {
  tribunal: string;
  numeroProcesso: string;
  classe: { codigo?: number; nome?: string } | null;
  assuntos: Array<{ codigo?: number; nome?: string }>;
  dataAjuizamento: string | null;
  ano: string | null;
  orgaoJulgador: { codigo?: number; nome?: string } | null;
  valor: number | null;
  grau: string | null;
  polo: "ATIVO" | "PASSIVO" | "INDEFINIDO" | null;
  parteContraria: string[];
  andamentos: ProcessoAndamento[];
  sourceUrl?: string | null;
}

export interface JudicialScanMeta {
  run_id: string | null;
  status: "queued" | "running" | "completed" | "failed" | "partial" | "budget_exceeded";
  consulted: number;
  supported: number;
  unavailable: number;
  found_processes: number;
}

export interface InvestigationJudicialSummary {
  supported: number;
  consulted: number;
  unavailable: number;
  matched_tribunals: number;
  found_processes: number;
}

export interface InvestigationJudicialCoverageItem {
  tribunal_id: string;
  tribunal_name: string;
  ramo: string;
  uf_scope: string;
  query_mode: string;
  status: "success" | "not_found" | "unavailable" | "error";
  status_reason?: string;
  latency_ms?: number;
  message?: string;
  connector_family: string;
  connector_version?: string;
  evidence_count: number;
  attempted_at: string;
  metadata?: Record<string, unknown>;
}

export interface InvestigationJudicialCoverageResponse {
  summary: InvestigationJudicialSummary;
  items: InvestigationJudicialCoverageItem[];
}

export interface InvestigationJudicialProcess {
  tribunal_id: string;
  tribunal_name: string;
  ramo: string;
  uf_scope: string;
  entity_node_id: string;
  process_key: string;
  numero_processo: string;
  classe?: string | null;
  assunto?: string | null;
  orgao_julgador?: string | null;
  data_ajuizamento?: string | null;
  valor_causa?: number | null;
  polo_empresa?: string | null;
  parte_contraria: string[];
  andamentos: ProcessoAndamento[];
  source_url?: string | null;
  evidence?: Array<{ label: string; value: string }>;
  created_at: string;
}

export interface InvestigationJudicialProcessesResponse {
  total: number;
  items: InvestigationJudicialProcess[];
}

export interface RiskAnalysis {
  company: CompanyData;
  score: number;
  classification: "Baixo" | "Médio" | "Alto" | "Crítico";
  flags: RiskFlag[];
  sources: DataSource[];
  summary: string;
  analyzed_at: string;
  judicial_processes?: JudicialProcess[];
  meta?: {
    sources_version: string;
    partial: boolean;
    snapshot_at: string | null;
    search_id?: string;
    search_requested_at?: string | null;
    search_analyzed_at?: string | null;
    deep_investigation?: {
      run_id: string | null;
      status: "queued" | "running" | "completed" | "failed" | "partial" | "budget_exceeded";
      auto_started: boolean;
    };
    judicial_scan?: JudicialScanMeta;
  };
  /** Laudo investigativo gerado por GenAI (OpenAI/Anthropic) */
  ai_analysis?: AiAnalysis;
  related_entities?: {
    partner_companies?: {
      source: string;
      status: "success" | "not_found" | "unavailable";
      message?: string;
      items: PartnerCompanyItem[];
    };
    graph?: {
      run_id: string;
      status: "queued" | "running" | "completed" | "failed" | "partial" | "budget_exceeded";
    };
    pf_reverse_lookup?: {
      status: "unavailable" | "queued" | "running";
      checked_pf_partners: number;
      cpf_full_count: number;
      cpf_masked_count: number;
      message: string;
      methods?: string[];
      run_id?: string | null;
    };
  };
}

export interface InvestigationStatus {
  id: string;
  root_cnpj: string;
  status: "queued" | "running" | "completed" | "failed" | "partial" | "budget_exceeded";
  started_at: string;
  finished_at: string | null;
  max_depth: number;
  max_entities: number;
  max_seconds: number;
  entities_discovered: number;
  entities_processed: number;
  depth_reached: number;
  flags_count: number;
  pending_nodes: number;
  error_nodes: number;
  elapsed_ms: number;
  progress_percent: number;
  partial: boolean;
  error_text?: string | null;
  judicial_scan?: InvestigationJudicialSummary;
}

export interface InvestigationGraphFinding {
  id: string;
  finding_id: string;
  severity: "low" | "medium" | "high" | "critical";
  title: string;
  description: string;
  weight: number;
  depth: number;
  confidence_level?: "CONFIRMADO" | "PROVAVEL" | "POSSIVEL" | null;
  confidence?: number | null;
  verification_status: "objective" | "probable" | "possible";
  source_id?: string | null;
  evidence?: Array<{ label: string; value: string }>;
  created_at?: string;
}

export interface InvestigationGraphNode {
  id: string;
  entity_type: string;
  label: string;
  depth: number;
  document_masked?: string;
  document_hash?: string;
  risk_score: number;
  risk_classification: "Baixo" | "Médio" | "Alto" | "Crítico";
  restriction_count: number;
  status: string;
  metadata?: Record<string, unknown>;
  findings?: InvestigationGraphFinding[];
}

export interface InvestigationGraphEdge {
  id: string;
  source_id: string;
  target_id: string;
  relationship: string;
  obligation_code?: string | null;
  obligation_label?: string | null;
  confidence?: number;
  source_base?: string | null;
  metadata?: Record<string, unknown>;
}

export interface InvestigationGraphResponse {
  nodes: InvestigationGraphNode[];
  edges: InvestigationGraphEdge[];
}

export interface InvestigationEvent {
  seq: number;
  level: "info" | "warn" | "error";
  agent: string;
  message: string;
  payload?: Record<string, unknown>;
  created_at: string;
}

export interface InvestigationEventsResponse {
  cursor: number;
  events: InvestigationEvent[];
}
