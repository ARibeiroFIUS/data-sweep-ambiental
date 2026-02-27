CREATE TABLE IF NOT EXISTS search_queries (
  id TEXT PRIMARY KEY,
  cnpj CHAR(14) NOT NULL,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  analyzed_at TIMESTAMPTZ,
  deep_run_id TEXT,
  result_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_search_queries_cnpj_requested
  ON search_queries (cnpj, requested_at DESC);

CREATE INDEX IF NOT EXISTS idx_search_queries_created
  ON search_queries (created_at DESC);
