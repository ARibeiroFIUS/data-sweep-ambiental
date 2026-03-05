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

export interface MunicipalResult {
  enquadrado: boolean;
  matches: MunicipalMatch[];
  legislacao: {
    lc140: string;
    consema: string;
    municipios_habilitados: string;
  };
  nota: string;
}

export interface AreaSystem {
  nome: string;
  url: string;
  descricao: string;
  tipo: "geo" | "lista" | "relatorio";
}

export interface AreasContaminadasResult {
  instrucao: string;
  sistemas: AreaSystem[];
  legislacao: {
    lei_estadual: string;
    decreto: string;
    it_cetesb: string;
  };
  alerta: string;
}

export interface EnvironmentalSummary {
  total_alerts: number;
  fte_alerts: number;
  ibama_alerts: number;
  cetesb_alerts: number;
  municipal_alerts: number;
  risk_level: "baixo" | "medio" | "alto";
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
  cnpj: string;
  company: EnvironmentalCompany;
  fte_deep_analysis: FteDeepAnalysis;
  ibama: IbamaResult;
  cetesb: CetesbResult;
  municipal: MunicipalResult;
  areas_contaminadas: AreasContaminadasResult;
  ai_report: EnvironmentalAiReport;
  govbr_context: GovBrContext | null;
  summary: EnvironmentalSummary;
  orchestration: EnvironmentalOrchestration;
  disclaimers: string[];
  sources: EnvironmentalSource[];
  analyzed_at: string;
}
