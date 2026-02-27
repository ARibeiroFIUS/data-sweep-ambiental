import { Pool } from "pg";

const DATABASE_URL = (process.env.DATABASE_URL ?? "").trim();

/** @type {Pool | null} */
let pool = null;

function getPool() {
  if (!DATABASE_URL) return null;

  if (!pool) {
    pool = new Pool({
      connectionString: DATABASE_URL,
      max: Number.parseInt(process.env.INVESTIGATION_DB_POOL_MAX ?? "6", 10),
      idleTimeoutMillis: 30_000,
      statement_timeout: Number.parseInt(process.env.INVESTIGATION_DB_STATEMENT_TIMEOUT_MS ?? "60000", 10),
      ssl: process.env.PGSSLMODE === "disable" ? false : { rejectUnauthorized: false },
    });
  }

  return pool;
}

function isMissingSchemaError(error) {
  return error && typeof error === "object" && "code" in error && error.code === "42P01";
}

function normalizeCnpj(value) {
  return String(value ?? "")
    .replace(/\D/g, "")
    .slice(0, 14);
}

function normalizeCpf(value) {
  return String(value ?? "")
    .replace(/\D/g, "")
    .slice(0, 11);
}

export function isInvestigationStoreEnabled() {
  return Boolean(DATABASE_URL);
}

export async function ensureInvestigationStoreReachable() {
  const activePool = getPool();
  if (!activePool) return false;
  await activePool.query("SELECT 1");
  return true;
}

export async function createInvestigationRun(input) {
  const activePool = getPool();
  if (!activePool) return null;

  try {
    const { rows } = await activePool.query(
      `INSERT INTO investigation_runs (
         id, root_cnpj, status, max_depth, max_entities, max_seconds, sources_version, snapshot_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        input.id,
        input.rootCnpj,
        input.status ?? "queued",
        input.maxDepth,
        input.maxEntities,
        input.maxSeconds,
        input.sourcesVersion ?? null,
        input.snapshotAt ? new Date(input.snapshotAt) : null,
      ],
    );

    return rows[0] ?? null;
  } catch (error) {
    if (isMissingSchemaError(error)) return null;
    throw error;
  }
}

export async function updateInvestigationRun(runId, patch = {}) {
  const activePool = getPool();
  if (!activePool || !runId) return null;

  const fields = [];
  const values = [];
  let idx = 1;

  const allowed = [
    "status",
    "finished_at",
    "entities_discovered",
    "entities_processed",
    "depth_reached",
    "flags_count",
    "partial",
    "error_text",
  ];

  for (const key of allowed) {
    if (!(key in patch)) continue;
    fields.push(`${key} = $${idx}`);
    values.push(patch[key]);
    idx += 1;
  }

  if (fields.length === 0) return getInvestigationRun(runId);

  values.push(runId);
  const { rows } = await activePool.query(
    `UPDATE investigation_runs
        SET ${fields.join(", ")}
      WHERE id = $${idx}
      RETURNING *`,
    values,
  );
  return rows[0] ?? null;
}

export async function getInvestigationRun(runId) {
  const activePool = getPool();
  if (!activePool || !runId) return null;

  try {
    const { rows } = await activePool.query(`SELECT * FROM investigation_runs WHERE id = $1 LIMIT 1`, [runId]);
    return rows[0] ?? null;
  } catch (error) {
    if (isMissingSchemaError(error)) return null;
    throw error;
  }
}

export async function listRecoverableInvestigationRuns(limit = 20) {
  const activePool = getPool();
  if (!activePool) return [];

  try {
    const { rows } = await activePool.query(
      `SELECT *
         FROM investigation_runs
        WHERE status IN ('queued', 'running')
        ORDER BY started_at ASC
        LIMIT $1`,
      [limit],
    );
    return rows;
  } catch (error) {
    if (isMissingSchemaError(error)) return [];
    throw error;
  }
}

export async function enqueueInvestigationNode(input) {
  const activePool = getPool();
  if (!activePool) return false;

  try {
    await activePool.query(
      `INSERT INTO investigation_nodes (
         run_id, node_id, entity_type, display_name, document_masked, document_hash, depth,
         source_agent, status, priority, metadata_json
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', $9, $10::jsonb)
       ON CONFLICT (run_id, node_id)
       DO UPDATE SET
         depth = LEAST(investigation_nodes.depth, EXCLUDED.depth),
         priority = GREATEST(investigation_nodes.priority, EXCLUDED.priority),
         metadata_json = COALESCE(investigation_nodes.metadata_json, '{}'::jsonb) || EXCLUDED.metadata_json,
         status = CASE
           WHEN investigation_nodes.status IN ('done', 'investigating') THEN investigation_nodes.status
           ELSE 'pending'
         END,
         updated_at = NOW()`,
      [
        input.runId,
        input.nodeId,
        input.entityType,
        input.displayName,
        input.documentMasked ?? null,
        input.documentHash ?? null,
        input.depth ?? 0,
        input.sourceAgent ?? "seed",
        input.priority ?? 0.5,
        JSON.stringify(input.metadata ?? {}),
      ],
    );
    return true;
  } catch (error) {
    if (isMissingSchemaError(error)) return false;
    throw error;
  }
}

export async function dequeueInvestigationNode(runId) {
  const activePool = getPool();
  if (!activePool || !runId) return null;

  const client = await activePool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `WITH candidate AS (
         SELECT run_id, node_id
           FROM investigation_nodes
          WHERE run_id = $1
            AND status = 'pending'
          ORDER BY depth ASC, priority DESC, first_seen_at ASC
          LIMIT 1
          FOR UPDATE SKIP LOCKED
       )
       UPDATE investigation_nodes n
          SET status = 'investigating',
              updated_at = NOW()
         FROM candidate c
        WHERE n.run_id = c.run_id
          AND n.node_id = c.node_id
        RETURNING n.*`,
      [runId],
    );
    await client.query("COMMIT");
    return rows[0] ?? null;
  } catch (error) {
    await client.query("ROLLBACK");
    if (isMissingSchemaError(error)) return null;
    throw error;
  } finally {
    client.release();
  }
}

export async function updateInvestigationNode(runId, nodeId, patch = {}) {
  const activePool = getPool();
  if (!activePool || !runId || !nodeId) return null;

  const fields = [];
  const values = [];
  let idx = 1;

  const map = {
    status: "status",
    displayName: "display_name",
    riskScore: "risk_score",
    riskClassification: "risk_classification",
    restrictionCount: "restriction_count",
    metadataJson: "metadata_json",
  };

  for (const [key, column] of Object.entries(map)) {
    if (!(key in patch)) continue;
    if (key === "metadataJson") {
      fields.push(`${column} = $${idx}::jsonb`);
      values.push(JSON.stringify(patch[key] ?? {}));
    } else {
      fields.push(`${column} = $${idx}`);
      values.push(patch[key]);
    }
    idx += 1;
  }

  fields.push("updated_at = NOW()");

  values.push(runId, nodeId);
  const { rows } = await activePool.query(
    `UPDATE investigation_nodes
        SET ${fields.join(", ")}
      WHERE run_id = $${idx}
        AND node_id = $${idx + 1}
      RETURNING *`,
    values,
  );
  return rows[0] ?? null;
}

export async function insertInvestigationEdge(input) {
  const activePool = getPool();
  if (!activePool) return false;

  await activePool.query(
    `INSERT INTO investigation_edges (
       run_id, edge_id, source_node_id, target_node_id, relationship,
       obligation_code, obligation_label, confidence, source_base, metadata_json
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
     ON CONFLICT (run_id, edge_id)
     DO NOTHING`,
    [
      input.runId,
      input.edgeId,
      input.sourceNodeId,
      input.targetNodeId,
      input.relationship,
      input.obligationCode ?? null,
      input.obligationLabel ?? null,
      input.confidence ?? 1,
      input.sourceBase ?? null,
      JSON.stringify(input.metadata ?? {}),
    ],
  );
  return true;
}

export async function insertInvestigationFinding(input) {
  const activePool = getPool();
  if (!activePool) return false;

  await activePool.query(
    `INSERT INTO investigation_findings (
       run_id, finding_id, entity_node_id, flag_id, severity, title, description,
       weight, depth, confidence_level, confidence, verification_status, source_id, evidence_json
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb)
     ON CONFLICT (run_id, finding_id)
     DO NOTHING`,
    [
      input.runId,
      input.findingId,
      input.entityNodeId,
      input.flagId,
      input.severity,
      input.title,
      input.description,
      input.weight ?? 0,
      input.depth ?? 0,
      input.confidenceLevel ?? null,
      input.confidence ?? null,
      input.verificationStatus ?? "objective",
      input.sourceId ?? null,
      JSON.stringify(input.evidence ?? []),
    ],
  );
  return true;
}

export async function appendInvestigationEvent(input) {
  const activePool = getPool();
  if (!activePool) return null;

  const { rows } = await activePool.query(
    `INSERT INTO investigation_events (run_id, level, agent, message, payload_json)
     VALUES ($1, $2, $3, $4, $5::jsonb)
     RETURNING id, run_id, level, agent, message, payload_json, created_at`,
    [
      input.runId,
      input.level ?? "info",
      input.agent ?? "orchestrator",
      String(input.message ?? "").slice(0, 2000),
      JSON.stringify(input.payload ?? {}),
    ],
  );
  return rows[0] ?? null;
}

export async function getInvestigationEvents(runId, afterSeq = 0, limit = 100) {
  const activePool = getPool();
  if (!activePool) return [];

  const { rows } = await activePool.query(
    `SELECT id, run_id, level, agent, message, payload_json, created_at
       FROM investigation_events
      WHERE run_id = $1
        AND id > $2
      ORDER BY id ASC
      LIMIT $3`,
    [runId, afterSeq, limit],
  );
  return rows;
}

export async function getInvestigationGraph(runId) {
  const activePool = getPool();
  if (!activePool) return null;

  const [nodeRows, edgeRows, findingRows] = await Promise.all([
    activePool.query(
      `SELECT n.*,
              COALESCE(f.finding_count, 0) AS finding_count
         FROM investigation_nodes n
         LEFT JOIN (
           SELECT run_id, entity_node_id, COUNT(*) AS finding_count
             FROM investigation_findings
            WHERE run_id = $1
            GROUP BY run_id, entity_node_id
         ) f
           ON f.run_id = n.run_id AND f.entity_node_id = n.node_id
        WHERE n.run_id = $1
        ORDER BY n.depth ASC, n.first_seen_at ASC`,
      [runId],
    ),
    activePool.query(
      `SELECT *
         FROM investigation_edges
        WHERE run_id = $1
        ORDER BY created_at ASC`,
      [runId],
    ),
    activePool.query(
      `SELECT *
         FROM investigation_findings
        WHERE run_id = $1
        ORDER BY created_at ASC`,
      [runId],
    ),
  ]);

  return {
    nodes: nodeRows.rows,
    edges: edgeRows.rows,
    findings: findingRows.rows,
  };
}

export async function getInvestigationStats(runId) {
  const activePool = getPool();
  if (!activePool) return null;

  const [nodeStats, flagsStats] = await Promise.all([
    activePool.query(
      `SELECT
         COUNT(*)::int AS total_nodes,
         COUNT(*) FILTER (WHERE status IN ('done', 'error', 'skipped'))::int AS processed_nodes,
         COUNT(*) FILTER (WHERE status = 'pending')::int AS pending_nodes,
         COUNT(*) FILTER (WHERE status = 'error')::int AS error_nodes,
         COALESCE(MAX(depth), 0)::int AS max_depth
       FROM investigation_nodes
       WHERE run_id = $1`,
      [runId],
    ),
    activePool.query(
      `SELECT COUNT(*)::int AS total_findings
         FROM investigation_findings
        WHERE run_id = $1`,
      [runId],
    ),
  ]);

  const node = nodeStats.rows[0] ?? {
    total_nodes: 0,
    processed_nodes: 0,
    pending_nodes: 0,
    error_nodes: 0,
    max_depth: 0,
  };
  const finding = flagsStats.rows[0] ?? { total_findings: 0 };

  return {
    totalNodes: node.total_nodes ?? 0,
    processedNodes: node.processed_nodes ?? 0,
    pendingNodes: node.pending_nodes ?? 0,
    errorNodes: node.error_nodes ?? 0,
    maxDepth: node.max_depth ?? 0,
    totalFindings: finding.total_findings ?? 0,
  };
}

export async function getInvestigationSummary(runId) {
  const [run, stats] = await Promise.all([getInvestigationRun(runId), getInvestigationStats(runId)]);
  if (!run) return null;

  const startedAt = run.started_at ? new Date(run.started_at).getTime() : Date.now();
  const elapsedMs = Math.max(0, Date.now() - startedAt);
  const discovered = stats?.totalNodes ?? run.entities_discovered ?? 0;
  const processed = stats?.processedNodes ?? run.entities_processed ?? 0;

  return {
    ...run,
    entities_discovered: discovered,
    entities_processed: processed,
    depth_reached: stats?.maxDepth ?? run.depth_reached ?? 0,
    flags_count: stats?.totalFindings ?? run.flags_count ?? 0,
    pending_nodes: stats?.pendingNodes ?? 0,
    error_nodes: stats?.errorNodes ?? 0,
    elapsed_ms: elapsedMs,
    progress_percent:
      run.status === "completed" || run.status === "partial" || run.status === "failed" || run.status === "budget_exceeded"
        ? 100
        : discovered > 0
          ? Math.min(99, Math.round((processed / discovered) * 100))
          : 0,
  };
}

export async function recoverStaleInvestigationRuns(maxAgeMs = 4 * 60 * 60 * 1000) {
  const activePool = getPool();
  if (!activePool) return 0;

  const client = await activePool.connect();
  try {
    await client.query("BEGIN");
    const { rowCount } = await client.query(
      `UPDATE investigation_runs
          SET status = 'queued',
              error_text = COALESCE(error_text, 'Recovered on startup'),
              finished_at = NULL
        WHERE status = 'running'
          AND started_at < NOW() - ($1 || ' milliseconds')::interval`,
      [maxAgeMs],
    );
    await client.query(
      `UPDATE investigation_nodes
          SET status = 'pending',
              updated_at = NOW()
        WHERE status = 'investigating'`,
    );
    await client.query("COMMIT");
    return rowCount ?? 0;
  } catch (error) {
    await client.query("ROLLBACK");
    if (isMissingSchemaError(error)) return 0;
    throw error;
  } finally {
    client.release();
  }
}

export async function closeInvestigationStore() {
  if (!pool) return;
  await pool.end();
  pool = null;
}

export async function upsertTribunalCatalog(entries) {
  const activePool = getPool();
  if (!activePool || !Array.isArray(entries) || entries.length === 0) return 0;

  try {
    let count = 0;
    for (const entry of entries) {
      await activePool.query(
        `INSERT INTO tribunal_catalog (
           tribunal_id, nome, ramo, uf_scope, connector_family, query_modes_supported_json,
           active, priority, config_json, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9::jsonb, NOW())
         ON CONFLICT (tribunal_id)
         DO UPDATE SET
           nome = EXCLUDED.nome,
           ramo = EXCLUDED.ramo,
           uf_scope = EXCLUDED.uf_scope,
           connector_family = EXCLUDED.connector_family,
           query_modes_supported_json = EXCLUDED.query_modes_supported_json,
           active = EXCLUDED.active,
           priority = EXCLUDED.priority,
           config_json = EXCLUDED.config_json,
           updated_at = NOW()`,
        [
          entry.tribunal_id,
          entry.nome,
          entry.ramo,
          entry.uf_scope,
          entry.connector_family,
          JSON.stringify(entry.query_modes_supported_json ?? []),
          Boolean(entry.active ?? true),
          Number(entry.priority ?? 50),
          JSON.stringify(entry.config_json ?? {}),
        ],
      );
      count += 1;
    }
    return count;
  } catch (error) {
    if (isMissingSchemaError(error)) return 0;
    throw error;
  }
}

export async function listActiveTribunalCatalog() {
  const activePool = getPool();
  if (!activePool) return [];

  try {
    const { rows } = await activePool.query(
      `SELECT tribunal_id, nome, ramo, uf_scope, connector_family, query_modes_supported_json,
              active, priority, config_json, updated_at
         FROM tribunal_catalog
        WHERE active = TRUE
        ORDER BY priority DESC, tribunal_id ASC`,
    );
    return rows;
  } catch (error) {
    if (isMissingSchemaError(error)) return [];
    throw error;
  }
}

export async function upsertInvestigationJudicialCoverage(input) {
  const activePool = getPool();
  if (!activePool) return false;

  try {
    await activePool.query(
      `INSERT INTO investigation_judicial_coverage (
         run_id, tribunal_id, entity_node_id, query_mode, status, status_reason, latency_ms,
         attempted_at, message, connector_version, connector_family, evidence_count, metadata_json
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, NOW(), $8, $9, $10, $11, $12::jsonb
       )
       ON CONFLICT (run_id, tribunal_id, entity_node_id, query_mode)
       DO UPDATE SET
         status = EXCLUDED.status,
         status_reason = EXCLUDED.status_reason,
         latency_ms = EXCLUDED.latency_ms,
         attempted_at = NOW(),
         message = EXCLUDED.message,
         connector_version = EXCLUDED.connector_version,
         connector_family = EXCLUDED.connector_family,
         evidence_count = EXCLUDED.evidence_count,
         metadata_json = EXCLUDED.metadata_json`,
      [
        input.runId,
        input.tribunalId,
        input.entityNodeId,
        input.queryMode,
        input.status,
        input.statusReason ?? null,
        Number.isFinite(Number(input.latencyMs)) ? Number(input.latencyMs) : null,
        input.message ? String(input.message).slice(0, 2000) : null,
        input.connectorVersion ?? null,
        input.connectorFamily ?? null,
        Number(input.evidenceCount ?? 0),
        JSON.stringify(input.metadata ?? {}),
      ],
    );
    return true;
  } catch (error) {
    if (isMissingSchemaError(error)) return false;
    throw error;
  }
}

export async function insertInvestigationJudicialProcesses(input) {
  const activePool = getPool();
  if (!activePool || !Array.isArray(input?.processes) || input.processes.length === 0) return 0;

  try {
    let inserted = 0;
    for (const process of input.processes) {
      const processKey =
        process?.process_key ??
        `${input.tribunalId}:${process?.numeroProcesso ?? ""}:${process?.polo ?? ""}`.slice(0, 255);
      await activePool.query(
        `INSERT INTO investigation_judicial_processes (
           run_id, tribunal_id, entity_node_id, process_key, numero_processo, classe, assunto,
           orgao_julgador, data_ajuizamento, valor_causa, polo_empresa, parte_contraria_json,
           andamentos_json, source_url, evidence_json, created_at
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13::jsonb, $14, $15::jsonb, NOW()
         )
         ON CONFLICT (run_id, process_key)
         DO NOTHING`,
        [
          input.runId,
          input.tribunalId,
          input.entityNodeId,
          processKey,
          process?.numeroProcesso ?? null,
          process?.classe?.nome ?? process?.classe ?? null,
          Array.isArray(process?.assuntos)
            ? process.assuntos.map((item) => item?.nome ?? item).filter(Boolean).slice(0, 8).join("; ")
            : null,
          process?.orgaoJulgador?.nome ?? process?.orgaoJulgador ?? null,
          process?.dataAjuizamento ? new Date(process.dataAjuizamento) : null,
          Number.isFinite(Number(process?.valor)) ? Number(process.valor) : null,
          process?.polo ?? null,
          JSON.stringify(Array.isArray(process?.parteContraria) ? process.parteContraria : []),
          JSON.stringify(Array.isArray(process?.andamentos) ? process.andamentos : []),
          process?.sourceUrl ?? null,
          JSON.stringify(Array.isArray(process?.evidence) ? process.evidence : []),
        ],
      );
      inserted += 1;
    }
    return inserted;
  } catch (error) {
    if (isMissingSchemaError(error)) return 0;
    throw error;
  }
}

export async function appendInvestigationJudicialEvent(input) {
  const activePool = getPool();
  if (!activePool) return null;

  try {
    const { rows } = await activePool.query(
      `WITH next_seq AS (
         SELECT COALESCE(MAX(seq), 0) + 1 AS seq
           FROM investigation_judicial_events
          WHERE run_id = $1
       )
       INSERT INTO investigation_judicial_events (run_id, seq, tribunal_id, level, message, payload_json)
       SELECT $1, next_seq.seq, $2, $3, $4, $5::jsonb
         FROM next_seq
       RETURNING id, run_id, seq, tribunal_id, level, message, payload_json, created_at`,
      [
        input.runId,
        input.tribunalId ?? null,
        input.level ?? "info",
        String(input.message ?? "").slice(0, 2000),
        JSON.stringify(input.payload ?? {}),
      ],
    );
    return rows[0] ?? null;
  } catch (error) {
    if (isMissingSchemaError(error)) return null;
    throw error;
  }
}

export async function getInvestigationJudicialCoverage(runId) {
  const activePool = getPool();
  if (!activePool || !runId) return [];

  try {
    const { rows } = await activePool.query(
      `SELECT c.run_id,
              c.tribunal_id,
              c.entity_node_id,
              c.query_mode,
              c.status,
              c.status_reason,
              c.latency_ms,
              c.attempted_at,
              c.message,
              c.connector_version,
              c.connector_family,
              c.evidence_count,
              c.metadata_json,
              t.nome,
              t.ramo,
              t.uf_scope,
              t.priority
         FROM investigation_judicial_coverage c
         LEFT JOIN tribunal_catalog t
           ON t.tribunal_id = c.tribunal_id
        WHERE c.run_id = $1
        ORDER BY COALESCE(t.priority, 0) DESC, c.tribunal_id ASC, c.query_mode ASC`,
      [runId],
    );
    return rows;
  } catch (error) {
    if (isMissingSchemaError(error)) return [];
    throw error;
  }
}

export async function getInvestigationJudicialProcesses(runId) {
  const activePool = getPool();
  if (!activePool || !runId) return [];

  try {
    const { rows } = await activePool.query(
      `SELECT p.*, t.nome, t.ramo, t.uf_scope
         FROM investigation_judicial_processes p
         LEFT JOIN tribunal_catalog t
           ON t.tribunal_id = p.tribunal_id
        WHERE p.run_id = $1
        ORDER BY p.created_at DESC, p.tribunal_id ASC`,
      [runId],
    );
    return rows;
  } catch (error) {
    if (isMissingSchemaError(error)) return [];
    throw error;
  }
}

export async function getInvestigationJudicialSummary(runId) {
  const activePool = getPool();
  if (!activePool || !runId) return null;

  try {
    const [catalogRows, coverageRows, processRows] = await Promise.all([
      activePool.query(`SELECT COUNT(*)::int AS total_supported FROM tribunal_catalog WHERE active = TRUE`),
      activePool.query(
        `SELECT
           COUNT(DISTINCT tribunal_id)::int AS tribunais_consultados,
           COUNT(DISTINCT tribunal_id) FILTER (WHERE status IN ('unavailable', 'error'))::int AS tribunais_indisponiveis,
           COUNT(DISTINCT tribunal_id) FILTER (WHERE status = 'success')::int AS tribunais_com_match
         FROM investigation_judicial_coverage
         WHERE run_id = $1`,
        [runId],
      ),
      activePool.query(
        `SELECT COUNT(*)::int AS processos_encontrados
           FROM investigation_judicial_processes
          WHERE run_id = $1`,
        [runId],
      ),
    ]);

    return {
      supported: catalogRows.rows[0]?.total_supported ?? 0,
      consulted: coverageRows.rows[0]?.tribunais_consultados ?? 0,
      unavailable: coverageRows.rows[0]?.tribunais_indisponiveis ?? 0,
      matched_tribunals: coverageRows.rows[0]?.tribunais_com_match ?? 0,
      found_processes: processRows.rows[0]?.processos_encontrados ?? 0,
    };
  } catch (error) {
    if (isMissingSchemaError(error)) {
      return {
        supported: 0,
        consulted: 0,
        unavailable: 0,
        matched_tribunals: 0,
        found_processes: 0,
      };
    }
    throw error;
  }
}

export async function createSearchQuery(input) {
  const activePool = getPool();
  if (!activePool) return null;

  const normalizedCnpj = normalizeCnpj(input?.cnpj);
  if (normalizedCnpj.length !== 14) return null;

  try {
    const { rows } = await activePool.query(
      `INSERT INTO search_queries (
         id, cnpj, analyzed_at, deep_run_id, result_json
       ) VALUES ($1, $2, $3, $4, $5::jsonb)
       RETURNING id, cnpj, requested_at, analyzed_at, deep_run_id, created_at`,
      [
        input?.id,
        normalizedCnpj,
        input?.analyzedAt ? new Date(input.analyzedAt) : null,
        input?.deepRunId ?? null,
        JSON.stringify(input?.result ?? {}),
      ],
    );
    return rows[0] ?? null;
  } catch (error) {
    if (isMissingSchemaError(error)) return null;
    throw error;
  }
}

export async function updateSearchQueryResult(searchId, patch = {}) {
  const activePool = getPool();
  if (!activePool || !searchId) return null;

  const fields = [];
  const values = [];
  let idx = 1;

  if ("result" in patch) {
    fields.push(`result_json = $${idx}::jsonb`);
    values.push(JSON.stringify(patch.result ?? {}));
    idx += 1;
  }
  if ("analyzedAt" in patch) {
    fields.push(`analyzed_at = $${idx}`);
    values.push(patch.analyzedAt ? new Date(patch.analyzedAt) : null);
    idx += 1;
  }
  if ("deepRunId" in patch) {
    fields.push(`deep_run_id = $${idx}`);
    values.push(patch.deepRunId ?? null);
    idx += 1;
  }

  if (fields.length === 0) return getSearchQueryById(searchId);

  values.push(searchId);

  try {
    const { rows } = await activePool.query(
      `UPDATE search_queries
          SET ${fields.join(", ")}
        WHERE id = $${idx}
        RETURNING id, cnpj, requested_at, analyzed_at, deep_run_id, result_json, created_at`,
      values,
    );
    return rows[0] ?? null;
  } catch (error) {
    if (isMissingSchemaError(error)) return null;
    throw error;
  }
}

export async function getSearchQueryById(searchId) {
  const activePool = getPool();
  if (!activePool || !searchId) return null;

  try {
    const { rows } = await activePool.query(
      `SELECT id, cnpj, requested_at, analyzed_at, deep_run_id, result_json, created_at
         FROM search_queries
        WHERE id = $1
        LIMIT 1`,
      [searchId],
    );
    return rows[0] ?? null;
  } catch (error) {
    if (isMissingSchemaError(error)) return null;
    throw error;
  }
}

export async function listSearchQueries({ cnpj, limit = 20, offset = 0 } = {}) {
  const activePool = getPool();
  if (!activePool) return [];

  const normalizedCnpj = normalizeCnpj(cnpj);
  const cappedLimit = Math.max(1, Math.min(100, Number.parseInt(String(limit), 10) || 20));
  const safeOffset = Math.max(0, Number.parseInt(String(offset), 10) || 0);

  try {
    const query =
      normalizedCnpj.length === 14
        ? `SELECT id, cnpj, requested_at, analyzed_at, deep_run_id, result_json, created_at
             FROM search_queries
            WHERE cnpj = $1
            ORDER BY requested_at DESC
            LIMIT $2 OFFSET $3`
        : `SELECT id, cnpj, requested_at, analyzed_at, deep_run_id, result_json, created_at
             FROM search_queries
            ORDER BY requested_at DESC
            LIMIT $1 OFFSET $2`;

    const values =
      normalizedCnpj.length === 14 ? [normalizedCnpj, cappedLimit, safeOffset] : [cappedLimit, safeOffset];

    const { rows } = await activePool.query(query, values);
    return rows;
  } catch (error) {
    if (isMissingSchemaError(error)) return [];
    throw error;
  }
}

export async function createPartnerSearchQuery(input) {
  const activePool = getPool();
  if (!activePool) return null;

  const normalizedCnpj = normalizeCnpj(input?.cnpj);
  const normalizedCpf = normalizeCpf(input?.cpf);
  const nome = String(input?.nome ?? "").trim();
  if (normalizedCnpj.length !== 14 || normalizedCpf.length !== 11 || !nome) return null;

  try {
    const { rows } = await activePool.query(
      `INSERT INTO partner_search_queries (
         id, cnpj, cpf, nome, analyzed_at, result_json
       ) VALUES ($1, $2, $3, $4, $5, $6::jsonb)
       RETURNING id, cnpj, cpf, nome, requested_at, analyzed_at, result_json, created_at`,
      [
        input?.id,
        normalizedCnpj,
        normalizedCpf,
        nome,
        input?.analyzedAt ? new Date(input.analyzedAt) : null,
        JSON.stringify(input?.result ?? {}),
      ],
    );
    return rows[0] ?? null;
  } catch (error) {
    if (isMissingSchemaError(error)) return null;
    throw error;
  }
}

export async function getPartnerSearchQueryById(searchId) {
  const activePool = getPool();
  if (!activePool || !searchId) return null;

  try {
    const { rows } = await activePool.query(
      `SELECT id, cnpj, cpf, nome, requested_at, analyzed_at, result_json, created_at
         FROM partner_search_queries
        WHERE id = $1
        LIMIT 1`,
      [searchId],
    );
    return rows[0] ?? null;
  } catch (error) {
    if (isMissingSchemaError(error)) return null;
    throw error;
  }
}

export async function listPartnerSearchQueries({ cnpj, cpf, limit = 20, offset = 0 } = {}) {
  const activePool = getPool();
  if (!activePool) return [];

  const normalizedCnpj = normalizeCnpj(cnpj);
  const normalizedCpf = normalizeCpf(cpf);
  const cappedLimit = Math.max(1, Math.min(100, Number.parseInt(String(limit), 10) || 20));
  const safeOffset = Math.max(0, Number.parseInt(String(offset), 10) || 0);

  try {
    if (normalizedCnpj.length === 14 && normalizedCpf.length === 11) {
      const { rows } = await activePool.query(
        `SELECT id, cnpj, cpf, nome, requested_at, analyzed_at, result_json, created_at
           FROM partner_search_queries
          WHERE cnpj = $1
            AND cpf = $2
          ORDER BY requested_at DESC
          LIMIT $3 OFFSET $4`,
        [normalizedCnpj, normalizedCpf, cappedLimit, safeOffset],
      );
      return rows;
    }

    if (normalizedCnpj.length === 14) {
      const { rows } = await activePool.query(
        `SELECT id, cnpj, cpf, nome, requested_at, analyzed_at, result_json, created_at
           FROM partner_search_queries
          WHERE cnpj = $1
          ORDER BY requested_at DESC
          LIMIT $2 OFFSET $3`,
        [normalizedCnpj, cappedLimit, safeOffset],
      );
      return rows;
    }

    if (normalizedCpf.length === 11) {
      const { rows } = await activePool.query(
        `SELECT id, cnpj, cpf, nome, requested_at, analyzed_at, result_json, created_at
           FROM partner_search_queries
          WHERE cpf = $1
          ORDER BY requested_at DESC
          LIMIT $2 OFFSET $3`,
        [normalizedCpf, cappedLimit, safeOffset],
      );
      return rows;
    }

    const { rows } = await activePool.query(
      `SELECT id, cnpj, cpf, nome, requested_at, analyzed_at, result_json, created_at
         FROM partner_search_queries
        ORDER BY requested_at DESC
        LIMIT $1 OFFSET $2`,
      [cappedLimit, safeOffset],
    );
    return rows;
  } catch (error) {
    if (isMissingSchemaError(error)) return [];
    throw error;
  }
}
