CREATE TABLE IF NOT EXISTS partner_search_queries (
  id TEXT PRIMARY KEY,
  cnpj CHAR(14) NOT NULL,
  cpf CHAR(11) NOT NULL,
  nome TEXT NOT NULL,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  analyzed_at TIMESTAMPTZ,
  result_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_partner_search_queries_cnpj_cpf_requested
  ON partner_search_queries (cnpj, cpf, requested_at DESC);

CREATE INDEX IF NOT EXISTS idx_partner_search_queries_created
  ON partner_search_queries (created_at DESC);
