import { BigQuery } from "@google-cloud/bigquery";
import { cleanDocument } from "./common-utils.mjs";

const BIGQUERY_PROJECT_ID = (process.env.BIGQUERY_PROJECT_ID ?? "").trim();
const BIGQUERY_LOCATION = (process.env.BIGQUERY_LOCATION ?? "US").trim();
const BIGQUERY_SOCIOS_TABLE = (process.env.BIGQUERY_SOCIOS_TABLE ?? "").trim();
const BIGQUERY_EMPRESAS_TABLE = (process.env.BIGQUERY_EMPRESAS_TABLE ?? "").trim();
const BIGQUERY_ESTABELECIMENTOS_TABLE = (process.env.BIGQUERY_ESTABELECIMENTOS_TABLE ?? "").trim();
const BIGQUERY_REVERSE_SQL = (process.env.BIGQUERY_REVERSE_SQL ?? "").trim();

/** @type {BigQuery | null} */
let client = null;

function getClient() {
  if (!BIGQUERY_PROJECT_ID) return null;
  if (!client) {
    const credentialsText = (process.env.BIGQUERY_CREDENTIALS_JSON ?? "").trim();
    client = new BigQuery({
      projectId: BIGQUERY_PROJECT_ID,
      ...(credentialsText ? { credentials: JSON.parse(credentialsText) } : {}),
    });
  }
  return client;
}

function buildDefaultSql() {
  return `
    WITH target_socios AS (
      SELECT DISTINCT LPAD(REGEXP_REPLACE(CAST(cnpj_basico AS STRING), r'\\D', ''), 8, '0') AS cnpj_basico
        FROM \`${BIGQUERY_SOCIOS_TABLE}\`
       WHERE REGEXP_REPLACE(CAST(cnpj_cpf_do_socio AS STRING), r'\\D', '') = @cpf
       LIMIT @limit
    )
    SELECT DISTINCT
      CONCAT(
        LPAD(REGEXP_REPLACE(CAST(est.cnpj_basico AS STRING), r'\\D', ''), 8, '0'),
        LPAD(REGEXP_REPLACE(CAST(est.cnpj_ordem AS STRING), r'\\D', ''), 4, '0'),
        LPAD(REGEXP_REPLACE(CAST(est.cnpj_dv AS STRING), r'\\D', ''), 2, '0')
      ) AS cnpj,
      CAST(emp.razao_social AS STRING) AS razao_social,
      CAST(est.uf AS STRING) AS uf,
      CAST(est.municipio AS STRING) AS municipio,
      CAST(est.situacao_cadastral AS STRING) AS situacao_cadastral
    FROM target_socios ts
    JOIN \`${BIGQUERY_ESTABELECIMENTOS_TABLE}\` est
      ON LPAD(REGEXP_REPLACE(CAST(est.cnpj_basico AS STRING), r'\\D', ''), 8, '0') = ts.cnpj_basico
    LEFT JOIN \`${BIGQUERY_EMPRESAS_TABLE}\` emp
      ON LPAD(REGEXP_REPLACE(CAST(emp.cnpj_basico AS STRING), r'\\D', ''), 8, '0') = ts.cnpj_basico
    LIMIT @limit
  `;
}

export function isBigQueryReverseLookupEnabled() {
  if (!BIGQUERY_PROJECT_ID) return false;
  if (BIGQUERY_REVERSE_SQL) return true;
  return Boolean(BIGQUERY_SOCIOS_TABLE && BIGQUERY_EMPRESAS_TABLE && BIGQUERY_ESTABELECIMENTOS_TABLE);
}

export async function lookupCompaniesByCpf(cpf, limit = 25) {
  const cleanCpf = cleanDocument(cpf);
  if (cleanCpf.length !== 11) return { status: "not_found", items: [], reason: "invalid_cpf" };

  if (!isBigQueryReverseLookupEnabled()) {
    return { status: "unavailable", items: [], reason: "bigquery_not_configured" };
  }

  const bigQueryClient = getClient();
  if (!bigQueryClient) {
    return { status: "unavailable", items: [], reason: "missing_project_id" };
  }

  const sql = BIGQUERY_REVERSE_SQL || buildDefaultSql();
  try {
    const [job] = await bigQueryClient.createQueryJob({
      query: sql,
      location: BIGQUERY_LOCATION,
      params: {
        cpf: cleanCpf,
        limit: Math.max(1, Math.min(200, Number(limit) || 25)),
      },
      types: { cpf: "STRING", limit: "INT64" },
      useLegacySql: false,
    });

    const [rows] = await job.getQueryResults();
    const items = rows
      .map((row) => ({
        cnpj: cleanDocument(row.cnpj ?? ""),
        razao_social: String(row.razao_social ?? "").trim(),
        uf: String(row.uf ?? "").trim(),
        municipio: String(row.municipio ?? "").trim(),
        situacao_cadastral: String(row.situacao_cadastral ?? "").trim(),
      }))
      .filter((row) => row.cnpj.length === 14);

    if (items.length === 0) {
      return { status: "not_found", items: [], reason: "no_related_companies" };
    }

    return { status: "success", items, reason: "ok" };
  } catch (error) {
    return {
      status: "error",
      items: [],
      reason: error instanceof Error ? error.message.slice(0, 500) : "query_failed",
    };
  }
}

