CREATE TABLE IF NOT EXISTS environmental_analysis_runs (
  analysis_id    TEXT PRIMARY KEY,
  cnpj           CHAR(14) NOT NULL,
  schema_version TEXT NOT NULL,
  risk_level     TEXT,
  payload_json   JSONB NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_environmental_analysis_runs_cnpj_created
  ON environmental_analysis_runs (cnpj, created_at DESC);

CREATE TABLE IF NOT EXISTS environmental_action_plan_items (
  analysis_id      TEXT NOT NULL REFERENCES environmental_analysis_runs(analysis_id) ON DELETE CASCADE,
  item_id          TEXT NOT NULL,
  title            TEXT NOT NULL,
  priority         TEXT NOT NULL DEFAULT 'media',
  owner            TEXT,
  due_date         DATE,
  status           TEXT NOT NULL DEFAULT 'pendente',
  source_refs_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (analysis_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_environmental_action_plan_items_analysis
  ON environmental_action_plan_items (analysis_id, updated_at DESC);
