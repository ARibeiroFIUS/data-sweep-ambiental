CREATE TABLE IF NOT EXISTS source_snapshots (
  id BIGSERIAL PRIMARY KEY,
  source_id TEXT NOT NULL,
  snapshot_ref TEXT NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  checksum TEXT,
  status TEXT NOT NULL,
  row_count BIGINT NOT NULL DEFAULT 0,
  UNIQUE (source_id, snapshot_ref)
);

CREATE INDEX IF NOT EXISTS idx_source_snapshots_source_fetched
  ON source_snapshots (source_id, fetched_at DESC);

CREATE TABLE IF NOT EXISTS source_index_cnpj (
  source_id TEXT NOT NULL,
  cnpj CHAR(14) NOT NULL,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  snapshot_ref TEXT NOT NULL,
  PRIMARY KEY (source_id, cnpj)
);

CREATE INDEX IF NOT EXISTS idx_source_index_cnpj_source_cnpj
  ON source_index_cnpj (source_id, cnpj);

CREATE TABLE IF NOT EXISTS source_job_runs (
  id BIGSERIAL PRIMARY KEY,
  source_id TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL,
  rows_read BIGINT NOT NULL DEFAULT 0,
  rows_indexed BIGINT NOT NULL DEFAULT 0,
  error_text TEXT
);

CREATE INDEX IF NOT EXISTS idx_source_job_runs_source_started
  ON source_job_runs (source_id, started_at DESC);
