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

## 3) Migração do Postgres

Execute no Postgres:

```sql
\i db/migrations/001_source_indexes.sql
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

## 7) Operação

- A API de análise usa índice PGFN no Postgres (sem download de ZIP em request).
- Se índice PGFN não estiver pronto, as fontes PGFN retornam `unavailable` com `status_reason`.
- O campo `meta.partial` indica se houve erro/indisponibilidade em alguma fonte.
