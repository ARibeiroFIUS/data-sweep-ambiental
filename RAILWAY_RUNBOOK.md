# Railway Runbook (Data Sweep Engine)

## 1) Provisionamento

1. Crie um serviço `web` (este repositório) no Railway.
2. Crie um banco Postgres no Railway e conecte `DATABASE_URL` ao serviço `web`.
3. (Opcional) Crie um bucket S3-compatible e configure:
   - `S3_ENDPOINT`
   - `S3_REGION`
   - `S3_BUCKET`
   - `S3_ACCESS_KEY_ID`
   - `S3_SECRET_ACCESS_KEY`

## 2) Variáveis obrigatórias

- `PORTAL_TRANSPARENCIA_API_KEY` (chave CGU)
- `DATABASE_URL` (Postgres Railway)
- `JOB_ADMIN_TOKEN` (token para endpoint de job)

Variáveis recomendadas para compliance ambiental com cache inteligente:

- `ENV_COMPLIANCE_REUSE_WINDOW_DAYS` (opcional, default `30`)
- `ENV_COMPLIANCE_REUSE_ENABLED` (opcional, default `true`)
- `OPENAI_FTE_RAG_TIMEOUT_MS` (opcional, default `18000`)
- `OPENAI_FTE_RAG_RETRY_TIMEOUT_MS` (opcional, default `0`)
- `OPENAI_RELATORIO_TIMEOUT_MS` (opcional, default `15000`)

## 3) Migração do Postgres

Execute no Postgres:

```sql
\i db/migrations/001_source_indexes.sql
\i db/migrations/002_deep_investigations.sql
\i db/migrations/003_judicial_coverage.sql
\i db/migrations/004_search_history.sql
\i db/migrations/005_brasilio_reverse_lookup_cache.sql
\i db/migrations/006_partner_search_history.sql
\i db/migrations/007_environmental_compliance_runs.sql
```

Ou rode o conteúdo do arquivo manualmente.

## 4) Sincronização PGFN

### Manual via CLI

```bash
npm run sync:pgfn
```

### Manual via endpoint protegido

```bash
curl -X POST "$APP_URL/api/jobs/sync-pgfn" \
  -H "x-job-token: $JOB_ADMIN_TOKEN"
```

## 5) Cron no Railway

Agende chamada diária para o endpoint:

- URL: `https://<seu-app>/api/jobs/sync-pgfn`
- Método: `POST`
- Header: `x-job-token: <JOB_ADMIN_TOKEN>`
- Janela sugerida: madrugada (ex.: 03:15 America/Sao_Paulo)

## 6) Feature flags de fontes

Todas default `true`.

- `FEATURE_RECEITA_BRASILAPI`
- `FEATURE_CGU_CEIS`
- `FEATURE_CGU_CNEP`
- `FEATURE_CGU_CEPIM`
- `FEATURE_CGU_ACORDOS_LENIENCIA`
- `FEATURE_CGU_CEAF`
- `FEATURE_CGU_SERVIDORES`
- `FEATURE_TCU_LICITANTES`
- `FEATURE_TCU_ELEITORAL`
- `FEATURE_MTE_TRABALHO_ESCRAVO`
- `FEATURE_PGFN_FGTS`
- `FEATURE_PGFN_PREVIDENCIARIO`
- `FEATURE_PGFN_NAO_PREVIDENCIARIO`
- `FEATURE_DATAJUD`
- `FEATURE_JUDICIAL_CRAWLER`
- `FEATURE_JUDICIAL_DATAJUD`
- `FEATURE_JUDICIAL_PJE`
- `FEATURE_JUDICIAL_ESAJ`
- `FEATURE_JUDICIAL_EPROC`
- `FEATURE_JUDICIAL_PROJUDI`
- `FEATURE_JUDICIAL_CUSTOM`

## 8) Variáveis opcionais da investigação profunda

- `INVESTIGATION_MAX_DEPTH` (default `5`)
- `INVESTIGATION_MAX_ENTITIES` (default `1200`)
- `INVESTIGATION_MAX_SECONDS` (default `1500`)
- `INVESTIGATION_NODE_CONCURRENCY` (default `4`)
- `INVESTIGATION_HARD_MAX_DEPTH` (default `8`)
- `INVESTIGATION_HARD_MAX_ENTITIES` (default `2500`)
- `INVESTIGATION_HARD_MAX_SECONDS` (default `7200`)
- `INVESTIGATION_HARD_MAX_NODE_CONCURRENCY` (default `8`)
- `INVESTIGATION_RELEVANCE_THRESHOLD` (default `0.3`)
- `JUDICIAL_TRIBUNAL_CONCURRENCY` (default `12`)
- `JUDICIAL_MAX_TRIBUNAIS_PER_ENTITY` (default `120`)

### BigQuery (reverse PF -> empresas)

- `BIGQUERY_PROJECT_ID`
- `BIGQUERY_LOCATION`
- `BIGQUERY_SOCIOS_TABLE`
- `BIGQUERY_EMPRESAS_TABLE`
- `BIGQUERY_ESTABELECIMENTOS_TABLE`
- `BIGQUERY_CREDENTIALS_JSON`
- (opcional) `BIGQUERY_REVERSE_SQL` para query customizada

### Brasil.io (fallback reverse PF -> empresas por CPF mascarado + nome)

- `BRASILIO_REVERSE_LOOKUP_ENABLED` (default `true`)
- `BRASILIO_REVERSE_SCAN_ENABLED` (default `true`)
- `BRASILIO_REVERSE_SCAN_TIMEOUT_MS` (default `90000`)
- `BRASILIO_REVERSE_MAX_MATCHES` (default `40`)
- `BRASILIO_REVERSE_CACHE_TTL_HOURS` (default `720`)
- `BRASILIO_REVERSE_SCANS_PER_RUN` (default `20`)
- (opcional) `BRASILIO_SOCIOS_URL` (default `https://data.brasil.io/dataset/socios-brasil/socios.csv.gz`)

## 9) Endpoints da investigação profunda

- `GET /api/investigations/:run_id`
- `GET /api/investigations/:run_id/graph`
- `GET /api/investigations/:run_id/events?cursor=0`

## 10) Operação

- A API de análise usa índice PGFN no Postgres (sem download de ZIP em request).
- Se índice PGFN não estiver pronto, as fontes PGFN retornam `unavailable` com `status_reason`.
- O campo `meta.partial` indica se houve erro/indisponibilidade em alguma fonte.
