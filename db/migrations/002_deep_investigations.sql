CREATE TABLE IF NOT EXISTS investigation_runs (
  id TEXT PRIMARY KEY,
  root_cnpj CHAR(14) NOT NULL,
  status TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  max_depth INTEGER NOT NULL DEFAULT 3,
  max_entities INTEGER NOT NULL DEFAULT 100,
  max_seconds INTEGER NOT NULL DEFAULT 180,
  entities_discovered INTEGER NOT NULL DEFAULT 0,
  entities_processed INTEGER NOT NULL DEFAULT 0,
  depth_reached INTEGER NOT NULL DEFAULT 0,
  flags_count INTEGER NOT NULL DEFAULT 0,
  partial BOOLEAN NOT NULL DEFAULT FALSE,
  error_text TEXT,
  sources_version TEXT,
  snapshot_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_investigation_runs_status_started
  ON investigation_runs (status, started_at DESC);

CREATE TABLE IF NOT EXISTS investigation_nodes (
  run_id TEXT NOT NULL REFERENCES investigation_runs(id) ON DELETE CASCADE,
  node_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  display_name TEXT NOT NULL,
  document_masked TEXT,
  document_hash TEXT,
  depth INTEGER NOT NULL DEFAULT 0,
  source_agent TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  priority DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  risk_score INTEGER NOT NULL DEFAULT 0,
  risk_classification TEXT NOT NULL DEFAULT 'Baixo',
  restriction_count INTEGER NOT NULL DEFAULT 0,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (run_id, node_id)
);

CREATE INDEX IF NOT EXISTS idx_investigation_nodes_run_depth_type
  ON investigation_nodes (run_id, depth, entity_type);

CREATE INDEX IF NOT EXISTS idx_investigation_nodes_run_status_priority
  ON investigation_nodes (run_id, status, depth, priority DESC, first_seen_at);

CREATE TABLE IF NOT EXISTS investigation_edges (
  run_id TEXT NOT NULL REFERENCES investigation_runs(id) ON DELETE CASCADE,
  edge_id TEXT NOT NULL,
  source_node_id TEXT NOT NULL,
  target_node_id TEXT NOT NULL,
  relationship TEXT NOT NULL,
  obligation_code TEXT,
  obligation_label TEXT,
  confidence DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  source_base TEXT,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (run_id, edge_id)
);

CREATE INDEX IF NOT EXISTS idx_investigation_edges_run_source_target
  ON investigation_edges (run_id, source_node_id, target_node_id);

CREATE TABLE IF NOT EXISTS investigation_findings (
  run_id TEXT NOT NULL REFERENCES investigation_runs(id) ON DELETE CASCADE,
  finding_id TEXT NOT NULL,
  entity_node_id TEXT NOT NULL,
  flag_id TEXT NOT NULL,
  severity TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  weight INTEGER NOT NULL DEFAULT 0,
  depth INTEGER NOT NULL DEFAULT 0,
  confidence_level TEXT,
  confidence DOUBLE PRECISION,
  verification_status TEXT NOT NULL DEFAULT 'objective',
  source_id TEXT,
  evidence_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (run_id, finding_id)
);

CREATE INDEX IF NOT EXISTS idx_investigation_findings_run_severity_verification
  ON investigation_findings (run_id, severity, verification_status);

CREATE INDEX IF NOT EXISTS idx_investigation_findings_run_entity
  ON investigation_findings (run_id, entity_node_id);

CREATE TABLE IF NOT EXISTS investigation_events (
  id BIGSERIAL PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES investigation_runs(id) ON DELETE CASCADE,
  level TEXT NOT NULL,
  agent TEXT NOT NULL,
  message TEXT NOT NULL,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_investigation_events_run_seq
  ON investigation_events (run_id, id);
