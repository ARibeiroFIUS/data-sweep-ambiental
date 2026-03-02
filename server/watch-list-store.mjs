/**
 * Watch List Store
 *
 * Tabela `watched_cnpjs` — persistência de CNPJs monitorados continuamente.
 *
 * Schema:
 *   cnpj              CHAR(14) PRIMARY KEY
 *   label             TEXT
 *   webhook_url       TEXT
 *   score_threshold   INTEGER  DEFAULT 10   -- delta mínimo para disparar webhook
 *   last_analyzed_at  TIMESTAMPTZ
 *   last_score        INTEGER
 *   last_classification TEXT
 *   last_flags_count  INTEGER
 *   last_subscores_json JSONB
 *   last_flag_ids_json JSONB
 *   added_at          TIMESTAMPTZ DEFAULT now()
 *   updated_at        TIMESTAMPTZ DEFAULT now()
 */

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
      max: 4,
      idleTimeoutMillis: 30_000,
      ssl: process.env.PGSSLMODE === "disable" ? false : { rejectUnauthorized: false },
    });
  }
  return pool;
}

export function isWatchListEnabled() {
  return Boolean(DATABASE_URL);
}

export async function ensureWatchListTable() {
  const activePool = getPool();
  if (!activePool) return false;

  await activePool.query(`
    CREATE TABLE IF NOT EXISTS watched_cnpjs (
      cnpj                CHAR(14)     NOT NULL PRIMARY KEY,
      label               TEXT,
      webhook_url         TEXT,
      score_threshold     INTEGER      NOT NULL DEFAULT 10,
      last_analyzed_at    TIMESTAMPTZ,
      last_score          INTEGER,
      last_classification TEXT,
      last_flags_count    INTEGER,
      last_subscores_json JSONB,
      last_flag_ids_json  JSONB,
      added_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
      updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now()
    )
  `);

  // Backward-compatible schema evolution for existing databases.
  await activePool.query(`ALTER TABLE watched_cnpjs ADD COLUMN IF NOT EXISTS last_flag_ids_json JSONB`);

  return true;
}

/**
 * Adiciona ou atualiza um CNPJ na watch list.
 * @param {{cnpj: string, label?: string, webhook_url?: string, score_threshold?: number}} params
 */
export async function upsertWatch({ cnpj, label, webhook_url, score_threshold = 10 }) {
  const activePool = getPool();
  if (!activePool) return null;

  const cleanCnpj = cleanDocument(cnpj);
  if (cleanCnpj.length !== 14) throw new Error(`CNPJ inválido: ${cnpj}`);

  const threshold = Number.isFinite(Number(score_threshold)) ? Math.max(1, Number(score_threshold)) : 10;

  const { rows } = await activePool.query(
    `INSERT INTO watched_cnpjs (cnpj, label, webhook_url, score_threshold, updated_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (cnpj) DO UPDATE SET
       label           = COALESCE(EXCLUDED.label, watched_cnpjs.label),
       webhook_url     = COALESCE(EXCLUDED.webhook_url, watched_cnpjs.webhook_url),
       score_threshold = EXCLUDED.score_threshold,
       updated_at      = now()
     RETURNING *`,
    [cleanCnpj, label ?? null, webhook_url ?? null, threshold],
  );

  return rows[0] ?? null;
}

/**
 * Remove um CNPJ da watch list.
 * @param {string} cnpj
 */
export async function removeWatch(cnpj) {
  const activePool = getPool();
  if (!activePool) return false;

  const cleanCnpj = cleanDocument(cnpj);
  const { rowCount } = await activePool.query(
    `DELETE FROM watched_cnpjs WHERE cnpj = $1`,
    [cleanCnpj],
  );
  return (rowCount ?? 0) > 0;
}

/**
 * Retorna todos os CNPJs monitorados.
 * @returns {Promise<Array>}
 */
export async function listWatched() {
  const activePool = getPool();
  if (!activePool) return [];

  const { rows } = await activePool.query(
    `SELECT cnpj, label, webhook_url, score_threshold,
            last_analyzed_at, last_score, last_classification,
            last_flags_count, last_subscores_json, last_flag_ids_json, added_at, updated_at
       FROM watched_cnpjs
      ORDER BY added_at DESC`,
  );
  return rows;
}

/**
 * Busca um item pelo CNPJ.
 * @param {string} cnpj
 */
export async function getWatch(cnpj) {
  const activePool = getPool();
  if (!activePool) return null;

  const cleanCnpj = cleanDocument(cnpj);
  const { rows } = await activePool.query(
    `SELECT * FROM watched_cnpjs WHERE cnpj = $1`,
    [cleanCnpj],
  );
  return rows[0] ?? null;
}

/**
 * Persiste o resultado da última análise de um CNPJ monitorado.
 * @param {string} cnpj
 * @param {{score: number, classification: string, flags_count: number, subscores?: object, flag_ids?: string[]}} result
 */
export async function updateWatchLastResult(cnpj, { score, classification, flags_count, subscores, flag_ids }) {
  const activePool = getPool();
  if (!activePool) return;

  const cleanCnpj = cleanDocument(cnpj);
  await activePool.query(
    `UPDATE watched_cnpjs SET
       last_analyzed_at    = now(),
       last_score          = $2,
       last_classification = $3,
       last_flags_count    = $4,
       last_subscores_json = $5,
       last_flag_ids_json  = $6,
       updated_at          = now()
     WHERE cnpj = $1`,
    [
      cleanCnpj,
      score,
      classification,
      flags_count,
      subscores ? JSON.stringify(subscores) : null,
      Array.isArray(flag_ids) ? JSON.stringify(flag_ids.filter(Boolean)) : null,
    ],
  );
}
