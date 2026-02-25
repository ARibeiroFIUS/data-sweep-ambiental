import { Pool } from "pg";
import { cleanDocument } from "./common-utils.mjs";

const DATABASE_URL = (process.env.DATABASE_URL ?? "").trim();

/** @type {Pool | null} */
let pool = null;

function getPool() {
  if (!DATABASE_URL) return null;

  if (!pool) {
    pool = new Pool({
      connectionString: DATABASE_URL,
      max: Number.parseInt(process.env.SOURCE_DB_POOL_MAX ?? "6", 10),
      idleTimeoutMillis: 30_000,
      statement_timeout: Number.parseInt(process.env.SOURCE_DB_STATEMENT_TIMEOUT_MS ?? "60000", 10),
      ssl: process.env.PGSSLMODE === "disable" ? false : { rejectUnauthorized: false },
    });
  }

  return pool;
}

function isMissingSchemaError(error) {
  return error && typeof error === "object" && "code" in error && error.code === "42P01";
}

export function isSourceIndexStoreEnabled() {
  return Boolean(DATABASE_URL);
}

export async function ensureSourceIndexStoreReachable() {
  const activePool = getPool();
  if (!activePool) return false;

  await activePool.query("SELECT 1");
  return true;
}

export async function getIndexedSourceMatch(sourceId, cnpj) {
  const activePool = getPool();
  if (!activePool) return null;

  const cleanCnpj = cleanDocument(cnpj);
  if (cleanCnpj.length !== 14) return null;

  try {
    const { rows } = await activePool.query(
      `SELECT cnpj, payload_json, snapshot_ref, first_seen_at, last_seen_at
         FROM source_index_cnpj
        WHERE source_id = $1
          AND cnpj = $2
          AND snapshot_ref = (
            SELECT snapshot_ref
              FROM source_snapshots
             WHERE source_id = $1
               AND status = 'success'
             ORDER BY fetched_at DESC
             LIMIT 1
          )
        LIMIT 1`,
      [sourceId, cleanCnpj],
    );

    return rows[0] ?? null;
  } catch (error) {
    if (isMissingSchemaError(error)) return null;
    throw error;
  }
}

export async function getLatestSnapshotAt(sourceIds) {
  const activePool = getPool();
  if (!activePool) return null;

  if (!Array.isArray(sourceIds) || sourceIds.length === 0) return null;

  try {
    const { rows } = await activePool.query(
      `SELECT MAX(fetched_at) AS snapshot_at
         FROM source_snapshots
        WHERE status = 'success'
          AND source_id = ANY($1::text[])`,
      [sourceIds],
    );

    const snapshotAt = rows[0]?.snapshot_at;
    if (!snapshotAt) return null;

    const dateValue = snapshotAt instanceof Date ? snapshotAt : new Date(snapshotAt);
    return Number.isNaN(dateValue.getTime()) ? null : dateValue.toISOString();
  } catch (error) {
    if (isMissingSchemaError(error)) return null;
    throw error;
  }
}

export async function createSourceJobRun(sourceId) {
  const activePool = getPool();
  if (!activePool) return null;

  try {
    const { rows } = await activePool.query(
      `INSERT INTO source_job_runs (source_id, status)
       VALUES ($1, 'running')
       RETURNING id`,
      [sourceId],
    );

    return rows[0]?.id ?? null;
  } catch (error) {
    if (isMissingSchemaError(error)) return null;
    throw error;
  }
}

export async function finishSourceJobRun(jobRunId, status, metrics = {}) {
  const activePool = getPool();
  if (!activePool || !jobRunId) return;

  await activePool.query(
    `UPDATE source_job_runs
        SET finished_at = NOW(),
            status = $2,
            rows_read = $3,
            rows_indexed = $4,
            error_text = $5
      WHERE id = $1`,
    [
      jobRunId,
      status,
      metrics.rowsRead ?? 0,
      metrics.rowsIndexed ?? 0,
      metrics.errorText ? String(metrics.errorText).slice(0, 4000) : null,
    ],
  );
}

export async function recordSourceSnapshot(sourceId, snapshotRef, data) {
  const activePool = getPool();
  if (!activePool) return;

  await activePool.query(
    `INSERT INTO source_snapshots (source_id, snapshot_ref, fetched_at, checksum, status, row_count)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (source_id, snapshot_ref)
     DO UPDATE SET fetched_at = EXCLUDED.fetched_at,
                   checksum = EXCLUDED.checksum,
                   status = EXCLUDED.status,
                   row_count = EXCLUDED.row_count`,
    [sourceId, snapshotRef, data.fetchedAt, data.checksum ?? null, data.status, data.rowCount ?? 0],
  );
}

export async function upsertSourceIndexBatch(sourceId, snapshotRef, records) {
  const activePool = getPool();
  if (!activePool || !Array.isArray(records) || records.length === 0) return;

  const values = [];
  const placeholders = [];
  let paramIndex = 1;

  for (const entry of records) {
    const cnpj = cleanDocument(entry?.cnpj ?? "");
    if (cnpj.length !== 14) continue;

    placeholders.push(`($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2}::jsonb, $${paramIndex + 3})`);
    values.push(sourceId, cnpj, JSON.stringify(entry.payload ?? {}), snapshotRef);
    paramIndex += 4;
  }

  if (placeholders.length === 0) return;

  await activePool.query(
    `INSERT INTO source_index_cnpj (source_id, cnpj, payload_json, snapshot_ref)
     VALUES ${placeholders.join(",")}
     ON CONFLICT (source_id, cnpj)
     DO UPDATE SET payload_json = EXCLUDED.payload_json,
                   snapshot_ref = EXCLUDED.snapshot_ref,
                   last_seen_at = NOW()`,
    values,
  );
}

export async function cleanupSourceIndexToSnapshot(sourceId, snapshotRef) {
  const activePool = getPool();
  if (!activePool) return;

  await activePool.query(
    `DELETE FROM source_index_cnpj
      WHERE source_id = $1
        AND snapshot_ref <> $2`,
    [sourceId, snapshotRef],
  );
}

export async function closeSourceIndexStore() {
  if (!pool) return;
  await pool.end();
  pool = null;
}
