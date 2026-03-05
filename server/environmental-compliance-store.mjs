import { Pool } from "pg";

const DATABASE_URL = (process.env.DATABASE_URL ?? "").trim();

/** @type {Pool | null} */
let pool = null;

function getPool() {
  if (!DATABASE_URL) return null;
  if (!pool) {
    pool = new Pool({
      connectionString: DATABASE_URL,
      max: Number.parseInt(process.env.ENV_COMPLIANCE_DB_POOL_MAX ?? "4", 10),
      idleTimeoutMillis: 30_000,
      statement_timeout: Number.parseInt(process.env.ENV_COMPLIANCE_DB_STATEMENT_TIMEOUT_MS ?? "60000", 10),
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

function normalizeStatus(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "em_andamento") return "em_andamento";
  if (normalized === "concluido") return "concluido";
  return "pendente";
}

function normalizePriority(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "alta") return "alta";
  if (normalized === "baixa") return "baixa";
  return "media";
}

export function isEnvironmentalComplianceStoreEnabled() {
  return Boolean(DATABASE_URL);
}

export async function ensureEnvironmentalComplianceTables() {
  const activePool = getPool();
  if (!activePool) return false;

  await activePool.query(`
    CREATE TABLE IF NOT EXISTS environmental_analysis_runs (
      analysis_id    TEXT PRIMARY KEY,
      cnpj           CHAR(14) NOT NULL,
      schema_version TEXT NOT NULL,
      risk_level     TEXT,
      payload_json   JSONB NOT NULL,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await activePool.query(`
    CREATE INDEX IF NOT EXISTS idx_environmental_analysis_runs_cnpj_created
      ON environmental_analysis_runs (cnpj, created_at DESC)
  `);

  await activePool.query(`
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
    )
  `);
  await activePool.query(`
    CREATE INDEX IF NOT EXISTS idx_environmental_action_plan_items_analysis
      ON environmental_action_plan_items (analysis_id, updated_at DESC)
  `);
  return true;
}

export async function saveEnvironmentalAnalysisRun(input) {
  const activePool = getPool();
  if (!activePool) return false;

  const analysisId = String(input?.analysisId ?? "").trim();
  const cnpj = normalizeCnpj(input?.cnpj);
  if (!analysisId || cnpj.length !== 14) return false;

  try {
    await activePool.query(
      `INSERT INTO environmental_analysis_runs (
         analysis_id, cnpj, schema_version, risk_level, payload_json
       ) VALUES ($1, $2, $3, $4, $5::jsonb)
       ON CONFLICT (analysis_id) DO UPDATE SET
         cnpj = EXCLUDED.cnpj,
         schema_version = EXCLUDED.schema_version,
         risk_level = EXCLUDED.risk_level,
         payload_json = EXCLUDED.payload_json`,
      [
        analysisId,
        cnpj,
        String(input?.schemaVersion ?? "br-v1"),
        input?.riskLevel ? String(input.riskLevel) : null,
        JSON.stringify(input?.payload ?? {}),
      ],
    );
    return true;
  } catch (error) {
    if (isMissingSchemaError(error)) return false;
    throw error;
  }
}

export async function getEnvironmentalAnalysisRun(analysisId) {
  const activePool = getPool();
  if (!activePool) return null;
  const id = String(analysisId ?? "").trim();
  if (!id) return null;

  try {
    const { rows } = await activePool.query(
      `SELECT analysis_id, cnpj, schema_version, risk_level, payload_json, created_at
         FROM environmental_analysis_runs
        WHERE analysis_id = $1
        LIMIT 1`,
      [id],
    );
    return rows[0] ?? null;
  } catch (error) {
    if (isMissingSchemaError(error)) return null;
    throw error;
  }
}

export async function listEnvironmentalAnalysisRuns({ cnpj = "", page = 1, limit = 20 } = {}) {
  const activePool = getPool();
  if (!activePool) {
    return {
      items: [],
      page: 1,
      limit: Math.max(1, Math.min(100, Number.parseInt(String(limit), 10) || 20)),
      total: 0,
    };
  }

  const normalizedCnpj = normalizeCnpj(cnpj);
  const safePage = Math.max(1, Number.parseInt(String(page), 10) || 1);
  const safeLimit = Math.max(1, Math.min(100, Number.parseInt(String(limit), 10) || 20));
  const offset = (safePage - 1) * safeLimit;

  const whereSql = normalizedCnpj.length === 14 ? "WHERE cnpj = $1" : "";
  const params = normalizedCnpj.length === 14 ? [normalizedCnpj] : [];

  try {
    const [{ rows: itemRows }, { rows: countRows }] = await Promise.all([
      activePool.query(
        `SELECT
           analysis_id,
           cnpj,
           schema_version,
           risk_level,
           created_at,
           payload_json->'company'->>'razao_social' AS razao_social,
           payload_json->'summary'->>'risk_level' AS payload_risk_level,
           payload_json->>'analyzed_at' AS analyzed_at
         FROM environmental_analysis_runs
         ${whereSql}
         ORDER BY created_at DESC
         LIMIT ${safeLimit}
         OFFSET ${offset}`,
        params,
      ),
      activePool.query(
        `SELECT COUNT(*)::int AS total
         FROM environmental_analysis_runs
         ${whereSql}`,
        params,
      ),
    ]);

    return {
      items: itemRows.map((row) => ({
        analysis_id: row.analysis_id,
        cnpj: row.cnpj,
        schema_version: row.schema_version,
        risk_level: row.risk_level || row.payload_risk_level || null,
        razao_social: row.razao_social || null,
        analyzed_at: row.analyzed_at || row.created_at,
        created_at: row.created_at,
      })),
      page: safePage,
      limit: safeLimit,
      total: Number(countRows?.[0]?.total ?? 0),
    };
  } catch (error) {
    if (isMissingSchemaError(error)) {
      return {
        items: [],
        page: safePage,
        limit: safeLimit,
        total: 0,
      };
    }
    throw error;
  }
}

export async function getLatestEnvironmentalAnalysisRunByCnpj({ cnpj = "", maxAgeDays = 30 } = {}) {
  const activePool = getPool();
  if (!activePool) return null;

  const normalizedCnpj = normalizeCnpj(cnpj);
  if (normalizedCnpj.length !== 14) return null;

  const safeMaxAgeDays = Math.max(1, Number.parseInt(String(maxAgeDays), 10) || 30);

  try {
    const { rows } = await activePool.query(
      `SELECT analysis_id, cnpj, schema_version, risk_level, payload_json, created_at
         FROM environmental_analysis_runs
        WHERE cnpj = $1
          AND created_at >= (NOW() - ($2 * INTERVAL '1 day'))
        ORDER BY created_at DESC
        LIMIT 1`,
      [normalizedCnpj, safeMaxAgeDays],
    );
    return rows[0] ?? null;
  } catch (error) {
    if (isMissingSchemaError(error)) return null;
    throw error;
  }
}

export async function listActionPlanItems(analysisId) {
  const activePool = getPool();
  if (!activePool) return [];
  const id = String(analysisId ?? "").trim();
  if (!id) return [];

  try {
    const { rows } = await activePool.query(
      `SELECT analysis_id, item_id, title, priority, owner, due_date, status, source_refs_json, created_at, updated_at
         FROM environmental_action_plan_items
        WHERE analysis_id = $1
        ORDER BY created_at ASC`,
      [id],
    );

    return rows.map((row) => ({
      id: row.item_id,
      title: row.title,
      priority: normalizePriority(row.priority),
      owner: row.owner ?? null,
      due_date: row.due_date ? new Date(row.due_date).toISOString().slice(0, 10) : null,
      status: normalizeStatus(row.status),
      source_refs: Array.isArray(row.source_refs_json) ? row.source_refs_json : [],
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));
  } catch (error) {
    if (isMissingSchemaError(error)) return [];
    throw error;
  }
}

export async function replaceActionPlanItems(analysisId, items = []) {
  const activePool = getPool();
  if (!activePool) return [];
  const id = String(analysisId ?? "").trim();
  if (!id) return [];

  const client = await activePool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`DELETE FROM environmental_action_plan_items WHERE analysis_id = $1`, [id]);

    for (const rawItem of Array.isArray(items) ? items : []) {
      const itemId = String(rawItem?.id ?? "").trim();
      const title = String(rawItem?.title ?? "").trim();
      if (!itemId || !title) continue;

      await client.query(
        `INSERT INTO environmental_action_plan_items (
           analysis_id, item_id, title, priority, owner, due_date, status, source_refs_json, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, NOW())`,
        [
          id,
          itemId,
          title.slice(0, 400),
          normalizePriority(rawItem?.priority),
          rawItem?.owner ? String(rawItem.owner).slice(0, 120) : null,
          rawItem?.due_date ? new Date(rawItem.due_date) : null,
          normalizeStatus(rawItem?.status),
          JSON.stringify(Array.isArray(rawItem?.source_refs) ? rawItem.source_refs : []),
        ],
      );
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    if (isMissingSchemaError(error)) return [];
    throw error;
  } finally {
    client.release();
  }

  return listActionPlanItems(id);
}

export async function upsertActionPlanItems(analysisId, items = []) {
  const activePool = getPool();
  if (!activePool) return [];
  const id = String(analysisId ?? "").trim();
  if (!id) return [];

  try {
    for (const rawItem of Array.isArray(items) ? items : []) {
      const itemId = String(rawItem?.id ?? "").trim();
      if (!itemId) continue;

      const hasAnyField =
        "title" in rawItem ||
        "priority" in rawItem ||
        "owner" in rawItem ||
        "due_date" in rawItem ||
        "status" in rawItem ||
        "source_refs" in rawItem;
      if (!hasAnyField) continue;

      const titleValue = String(rawItem?.title ?? "").trim();
      const upsertTitle = titleValue || `Acao ${itemId}`;

      await activePool.query(
        `INSERT INTO environmental_action_plan_items (
           analysis_id, item_id, title, priority, owner, due_date, status, source_refs_json, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, NOW())
         ON CONFLICT (analysis_id, item_id) DO UPDATE SET
           title = COALESCE(NULLIF(EXCLUDED.title, ''), environmental_action_plan_items.title),
           priority = EXCLUDED.priority,
           owner = EXCLUDED.owner,
           due_date = EXCLUDED.due_date,
           status = EXCLUDED.status,
           source_refs_json = EXCLUDED.source_refs_json,
           updated_at = NOW()`,
        [
          id,
          itemId,
          upsertTitle.slice(0, 400),
          normalizePriority(rawItem?.priority),
          "owner" in rawItem ? (rawItem?.owner ? String(rawItem.owner).slice(0, 120) : null) : null,
          "due_date" in rawItem && rawItem?.due_date ? new Date(rawItem.due_date) : null,
          normalizeStatus(rawItem?.status),
          JSON.stringify(Array.isArray(rawItem?.source_refs) ? rawItem.source_refs : []),
        ],
      );
    }
  } catch (error) {
    if (isMissingSchemaError(error)) return [];
    throw error;
  }

  return listActionPlanItems(id);
}

export async function closeEnvironmentalComplianceStore() {
  if (!pool) return;
  await pool.end();
  pool = null;
}
