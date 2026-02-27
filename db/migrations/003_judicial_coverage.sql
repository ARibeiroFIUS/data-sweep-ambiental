CREATE TABLE IF NOT EXISTS tribunal_catalog (
  tribunal_id TEXT PRIMARY KEY,
  nome TEXT NOT NULL,
  ramo TEXT NOT NULL,
  uf_scope TEXT NOT NULL,
  connector_family TEXT NOT NULL,
  query_modes_supported_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  priority INTEGER NOT NULL DEFAULT 50,
  config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tribunal_catalog_active_priority
  ON tribunal_catalog (active, priority DESC, tribunal_id);

CREATE INDEX IF NOT EXISTS idx_tribunal_catalog_ramo
  ON tribunal_catalog (ramo, active);

CREATE TABLE IF NOT EXISTS investigation_judicial_coverage (
  id BIGSERIAL PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES investigation_runs(id) ON DELETE CASCADE,
  tribunal_id TEXT NOT NULL,
  entity_node_id TEXT NOT NULL,
  query_mode TEXT NOT NULL,
  status TEXT NOT NULL,
  status_reason TEXT,
  latency_ms INTEGER,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  message TEXT,
  connector_version TEXT,
  connector_family TEXT,
  evidence_count INTEGER NOT NULL DEFAULT 0,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (run_id, tribunal_id, entity_node_id, query_mode)
);

CREATE INDEX IF NOT EXISTS idx_investigation_judicial_coverage_run_tribunal_status
  ON investigation_judicial_coverage (run_id, tribunal_id, status);

CREATE INDEX IF NOT EXISTS idx_investigation_judicial_coverage_run_entity_tribunal
  ON investigation_judicial_coverage (run_id, entity_node_id, tribunal_id);

CREATE INDEX IF NOT EXISTS idx_investigation_judicial_coverage_tribunal_attempted
  ON investigation_judicial_coverage (tribunal_id, attempted_at DESC);

CREATE TABLE IF NOT EXISTS investigation_judicial_processes (
  id BIGSERIAL PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES investigation_runs(id) ON DELETE CASCADE,
  tribunal_id TEXT NOT NULL,
  entity_node_id TEXT NOT NULL,
  process_key TEXT NOT NULL,
  numero_processo TEXT,
  classe TEXT,
  assunto TEXT,
  orgao_julgador TEXT,
  data_ajuizamento TIMESTAMPTZ,
  valor_causa DOUBLE PRECISION,
  polo_empresa TEXT,
  parte_contraria_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  andamentos_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  source_url TEXT,
  evidence_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (run_id, process_key)
);

CREATE INDEX IF NOT EXISTS idx_investigation_judicial_processes_run_entity_tribunal
  ON investigation_judicial_processes (run_id, entity_node_id, tribunal_id);

CREATE INDEX IF NOT EXISTS idx_investigation_judicial_processes_run_created
  ON investigation_judicial_processes (run_id, created_at DESC);

CREATE TABLE IF NOT EXISTS investigation_judicial_events (
  id BIGSERIAL PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES investigation_runs(id) ON DELETE CASCADE,
  seq BIGINT NOT NULL,
  tribunal_id TEXT,
  level TEXT NOT NULL,
  message TEXT NOT NULL,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (run_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_investigation_judicial_events_run_seq
  ON investigation_judicial_events (run_id, seq);
