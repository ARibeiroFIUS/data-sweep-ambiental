CREATE TABLE IF NOT EXISTS reverse_lookup_brasilio_cache (
  cpf_masked CHAR(11) NOT NULL,
  nome_norm TEXT NOT NULL,
  nome_original TEXT,
  status TEXT NOT NULL,
  status_reason TEXT,
  items_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  matches_count INTEGER NOT NULL DEFAULT 0,
  scanned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source_url TEXT NOT NULL,
  source_last_modified TEXT,
  source_etag TEXT,
  latency_ms INTEGER,
  error_text TEXT,
  PRIMARY KEY (cpf_masked, nome_norm)
);

CREATE INDEX IF NOT EXISTS idx_reverse_lookup_brasilio_cache_scanned
  ON reverse_lookup_brasilio_cache (scanned_at DESC);

CREATE INDEX IF NOT EXISTS idx_reverse_lookup_brasilio_cache_status
  ON reverse_lookup_brasilio_cache (status, scanned_at DESC);
