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
}

export interface DataSource {
  id?: string;
  name: string;
  status: "success" | "error" | "not_found" | "unavailable";
  message?: string;
  status_reason?: string;
  latency_ms?: number;
  evidence_count?: number;
}

export interface RiskAnalysis {
  company: CompanyData;
  score: number;
  classification: "Baixo" | "Médio" | "Alto" | "Crítico";
  flags: RiskFlag[];
  sources: DataSource[];
  summary: string;
  analyzed_at: string;
  meta?: {
    sources_version: string;
    partial: boolean;
    snapshot_at: string | null;
  };
}
