import readline from "node:readline";
import { Readable } from "node:stream";
import { createGunzip } from "node:zlib";
import { Pool } from "pg";
import { cleanDocument, normalizePersonName, parseBooleanEnv, parseDelimitedLine } from "./common-utils.mjs";
import { fetchWithTimeout } from "./http-utils.mjs";

const DATABASE_URL = (process.env.DATABASE_URL ?? "").trim();
const BRASILIO_SOCIOS_URL =
  (process.env.BRASILIO_SOCIOS_URL ?? "").trim() ||
  "https://data.brasil.io/dataset/socios-brasil/socios.csv.gz";
const BRASILIO_REVERSE_LOOKUP_ENABLED = parseBooleanEnv(
  process.env.BRASILIO_REVERSE_LOOKUP_ENABLED,
  true,
);
const BRASILIO_REVERSE_SCAN_ENABLED = parseBooleanEnv(
  process.env.BRASILIO_REVERSE_SCAN_ENABLED,
  true,
);
const BRASILIO_REVERSE_MAX_MATCHES = Math.max(
  1,
  Number.parseInt(process.env.BRASILIO_REVERSE_MAX_MATCHES ?? "40", 10) || 40,
);
const BRASILIO_REVERSE_SCAN_TIMEOUT_MS = Math.max(
  10_000,
  Number.parseInt(process.env.BRASILIO_REVERSE_SCAN_TIMEOUT_MS ?? "90000", 10) || 90_000,
);
const BRASILIO_REVERSE_CACHE_TTL_HOURS = Math.max(
  1,
  Number.parseInt(process.env.BRASILIO_REVERSE_CACHE_TTL_HOURS ?? "720", 10) || 720,
);

/** @type {Pool | null} */
let pool = null;

function getPool() {
  if (!DATABASE_URL) return null;
  if (!pool) {
    pool = new Pool({
      connectionString: DATABASE_URL,
      max: Number.parseInt(process.env.REVERSE_LOOKUP_DB_POOL_MAX ?? "2", 10),
      idleTimeoutMillis: 30_000,
      statement_timeout: Number.parseInt(process.env.REVERSE_LOOKUP_DB_STATEMENT_TIMEOUT_MS ?? "45000", 10),
      ssl: process.env.PGSSLMODE === "disable" ? false : { rejectUnauthorized: false },
    });
  }
  return pool;
}

function isMissingSchemaError(error) {
  return error && typeof error === "object" && "code" in error && error.code === "42P01";
}

function canonicalCpfMasked(value) {
  const raw = String(value ?? "").trim();
  if (/^\*{3}\d{6}\*{2}$/.test(raw)) return raw;

  const digits = cleanDocument(raw);
  if (digits.length === 11) {
    return `***${digits.slice(3, 9)}**`;
  }

  if (digits.length === 6) {
    return `***${digits}**`;
  }

  return "";
}

function normalizeLookupName(value) {
  return normalizePersonName(value);
}

function normalizeCompanyRow(row) {
  const cnpj = cleanDocument(row?.cnpj ?? "");
  if (cnpj.length !== 14) return null;
  return {
    cnpj,
    razao_social: String(row?.razao_social ?? "").trim(),
  };
}

function parseScannedAt(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isCacheFresh(row) {
  const scannedAt = parseScannedAt(row?.scanned_at);
  if (!scannedAt) return false;

  const ttlMs = BRASILIO_REVERSE_CACHE_TTL_HOURS * 60 * 60 * 1000;
  return Date.now() - scannedAt.getTime() <= ttlMs;
}

async function loadCachedLookup(cpfMasked, nomeNorm) {
  const activePool = getPool();
  if (!activePool) return { status: "unavailable", reason: "database_not_configured" };

  try {
    const { rows } = await activePool.query(
      `SELECT cpf_masked, nome_norm, status, status_reason, items_json, matches_count,
              scanned_at, source_last_modified, source_etag, latency_ms, error_text
         FROM reverse_lookup_brasilio_cache
        WHERE cpf_masked = $1
          AND nome_norm = $2
        LIMIT 1`,
      [cpfMasked, nomeNorm],
    );

    if (!rows[0]) {
      return { status: "cache_miss", reason: "cache_miss" };
    }

    const row = rows[0];
    const fresh = isCacheFresh(row);
    const items = Array.isArray(row.items_json)
      ? row.items_json.map(normalizeCompanyRow).filter(Boolean)
      : [];

    return {
      status: "cache_hit",
      reason: fresh ? "cache_fresh" : "cache_stale",
      fresh,
      row,
      items,
    };
  } catch (error) {
    if (isMissingSchemaError(error)) {
      return { status: "unavailable", reason: "schema_missing" };
    }

    return {
      status: "error",
      reason: error instanceof Error ? error.message.slice(0, 400) : "cache_read_failed",
    };
  }
}

async function upsertCacheRow(cpfMasked, nomeNorm, nomeOriginal, payload) {
  const activePool = getPool();
  if (!activePool) return;

  try {
    await activePool.query(
      `INSERT INTO reverse_lookup_brasilio_cache (
         cpf_masked, nome_norm, nome_original, status, status_reason,
         items_json, matches_count, scanned_at, source_url, source_last_modified,
         source_etag, latency_ms, error_text
       ) VALUES (
         $1, $2, $3, $4, $5,
         $6::jsonb, $7, NOW(), $8, $9,
         $10, $11, $12
       )
       ON CONFLICT (cpf_masked, nome_norm)
       DO UPDATE SET
         nome_original = EXCLUDED.nome_original,
         status = EXCLUDED.status,
         status_reason = EXCLUDED.status_reason,
         items_json = EXCLUDED.items_json,
         matches_count = EXCLUDED.matches_count,
         scanned_at = EXCLUDED.scanned_at,
         source_url = EXCLUDED.source_url,
         source_last_modified = EXCLUDED.source_last_modified,
         source_etag = EXCLUDED.source_etag,
         latency_ms = EXCLUDED.latency_ms,
         error_text = EXCLUDED.error_text`,
      [
        cpfMasked,
        nomeNorm,
        String(nomeOriginal ?? "").trim(),
        payload.status,
        payload.statusReason ?? null,
        JSON.stringify(payload.items ?? []),
        Number(payload.matchesCount ?? 0),
        BRASILIO_SOCIOS_URL,
        payload.sourceLastModified ?? null,
        payload.sourceEtag ?? null,
        Number(payload.latencyMs ?? 0),
        payload.errorText ?? null,
      ],
    );
  } catch {
    // best effort cache write
  }
}

async function scanSociosCsvGz(cpfMasked, nomeNorm, { limit }) {
  const startedAt = Date.now();
  const response = await fetchWithTimeout(BRASILIO_SOCIOS_URL, BRASILIO_REVERSE_SCAN_TIMEOUT_MS);
  if (!response || !response.ok || !response.body) {
    return {
      status: "unavailable",
      reason: "download_failed",
      items: [],
      latencyMs: Date.now() - startedAt,
      sourceLastModified: response?.headers?.get("last-modified") ?? null,
      sourceEtag: response?.headers?.get("etag") ?? null,
    };
  }

  const sourceLastModified = response.headers.get("last-modified");
  const sourceEtag = response.headers.get("etag");
  const targetLimit = Math.max(1, Math.min(limit, BRASILIO_REVERSE_MAX_MATCHES));

  const seen = new Map();
  let lineNo = 0;
  let timeoutReached = false;

  let cnpjIndex = -1;
  let razaoIndex = -1;
  let cpfMaskedIndex = -1;
  let nomeSocioIndex = -1;

  const gunzip = createGunzip();
  const decodedStream = Readable.fromWeb(response.body).pipe(gunzip);
  const lineReader = readline.createInterface({
    input: decodedStream,
    crlfDelay: Infinity,
  });

  for await (const line of lineReader) {
    if (!line) continue;
    lineNo += 1;

    if (Date.now() - startedAt > BRASILIO_REVERSE_SCAN_TIMEOUT_MS) {
      timeoutReached = true;
      break;
    }

    const cols = parseDelimitedLine(line, ",");
    if (lineNo === 1) {
      const headers = cols.map((value) => String(value ?? "").trim().toLowerCase());
      cnpjIndex = headers.indexOf("cnpj");
      razaoIndex = headers.indexOf("razao_social");
      cpfMaskedIndex = headers.indexOf("cpf_cnpj_socio");
      nomeSocioIndex = headers.indexOf("nome_socio");
      continue;
    }

    if (cnpjIndex < 0 || cpfMaskedIndex < 0 || nomeSocioIndex < 0) {
      return {
        status: "error",
        reason: "invalid_csv_schema",
        items: [],
        latencyMs: Date.now() - startedAt,
        sourceLastModified,
        sourceEtag,
      };
    }

    const maskedFromRow = canonicalCpfMasked(cols[cpfMaskedIndex] ?? "");
    if (maskedFromRow !== cpfMasked) continue;

    const normalizedName = normalizeLookupName(cols[nomeSocioIndex] ?? "");
    if (!normalizedName || normalizedName !== nomeNorm) continue;

    const cnpj = cleanDocument(cols[cnpjIndex] ?? "");
    if (cnpj.length !== 14) continue;

    if (!seen.has(cnpj)) {
      seen.set(cnpj, {
        cnpj,
        razao_social: razaoIndex >= 0 ? String(cols[razaoIndex] ?? "").trim() : "",
      });
    }

    if (seen.size >= targetLimit) {
      break;
    }
  }

  const items = Array.from(seen.values());
  if (items.length > 0) {
    return {
      status: "success",
      reason: timeoutReached ? "partial_scan_timeout" : "ok",
      items,
      latencyMs: Date.now() - startedAt,
      sourceLastModified,
      sourceEtag,
    };
  }

  if (timeoutReached) {
    return {
      status: "unavailable",
      reason: "scan_timeout",
      items: [],
      latencyMs: Date.now() - startedAt,
      sourceLastModified,
      sourceEtag,
    };
  }

  return {
    status: "not_found",
    reason: "no_related_companies",
    items: [],
    latencyMs: Date.now() - startedAt,
    sourceLastModified,
    sourceEtag,
  };
}

export function isBrasilioReverseLookupEnabled() {
  return BRASILIO_REVERSE_LOOKUP_ENABLED;
}

export function buildCpfMaskedFromFull(cpf) {
  return canonicalCpfMasked(cpf);
}

/**
 * Reverse lookup PF -> empresas usando brasil.io (socios-brasil).
 *
 * Observação: a base usa CPF mascarado. Resultado é probabilístico
 * (nome + 6 dígitos centrais) e não confirma CPF completo.
 */
export async function lookupCompaniesByMaskedProfile(input = {}) {
  if (!BRASILIO_REVERSE_LOOKUP_ENABLED) {
    return { status: "unavailable", items: [], reason: "feature_disabled", scan_executed: false };
  }

  const cpfMasked = canonicalCpfMasked(input.cpfMasked ?? "");
  const nomeNorm = normalizeLookupName(input.nome ?? "");
  const limit = Math.max(1, Math.min(Number(input.limit ?? 25) || 25, BRASILIO_REVERSE_MAX_MATCHES));
  const forceRefresh = Boolean(input.forceRefresh);
  const allowScanOnMiss = input.allowScanOnMiss !== false;

  if (!cpfMasked || !nomeNorm) {
    return { status: "not_found", items: [], reason: "missing_profile", scan_executed: false };
  }

  const cached = await loadCachedLookup(cpfMasked, nomeNorm);
  if (cached.status === "cache_hit" && cached.fresh && !forceRefresh) {
    return {
      status: cached.row.status,
      items: cached.items.slice(0, limit),
      reason: cached.row.status_reason || "cache_fresh",
      from_cache: true,
      scan_executed: false,
      snapshot_at: cached.row.scanned_at,
      source_last_modified: cached.row.source_last_modified ?? null,
      source_etag: cached.row.source_etag ?? null,
    };
  }

  if (!BRASILIO_REVERSE_SCAN_ENABLED) {
    if (cached.status === "cache_hit") {
      return {
        status: cached.row.status,
        items: cached.items.slice(0, limit),
        reason: "cache_stale_scan_disabled",
        from_cache: true,
        scan_executed: false,
        snapshot_at: cached.row.scanned_at,
        source_last_modified: cached.row.source_last_modified ?? null,
        source_etag: cached.row.source_etag ?? null,
      };
    }

    return { status: "unavailable", items: [], reason: "scan_disabled", scan_executed: false };
  }

  if (!allowScanOnMiss) {
    if (cached.status === "cache_hit") {
      return {
        status: cached.row.status,
        items: cached.items.slice(0, limit),
        reason: "cache_stale_scan_budget_blocked",
        from_cache: true,
        snapshot_at: cached.row.scanned_at,
        source_last_modified: cached.row.source_last_modified ?? null,
        source_etag: cached.row.source_etag ?? null,
        scan_executed: false,
      };
    }
    return { status: "unavailable", items: [], reason: "scan_budget_exceeded", scan_executed: false };
  }

  if (cached.status === "unavailable" || cached.status === "error") {
    return { status: "unavailable", items: [], reason: cached.reason || "cache_unavailable", scan_executed: false };
  }

  const scanned = await scanSociosCsvGz(cpfMasked, nomeNorm, { limit });

  await upsertCacheRow(cpfMasked, nomeNorm, input.nome ?? "", {
    status: scanned.status,
    statusReason: scanned.reason,
    items: scanned.items,
    matchesCount: scanned.items.length,
    sourceLastModified: scanned.sourceLastModified ?? null,
    sourceEtag: scanned.sourceEtag ?? null,
    latencyMs: scanned.latencyMs,
    errorText: scanned.status === "error" ? scanned.reason : null,
  });

  return {
    status: scanned.status,
    items: scanned.items.slice(0, limit),
    reason: scanned.reason,
    from_cache: false,
    scan_executed: true,
    source_last_modified: scanned.sourceLastModified ?? null,
    source_etag: scanned.sourceEtag ?? null,
    latency_ms: scanned.latencyMs,
  };
}
