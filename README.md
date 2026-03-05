# Welcome to your Lovable project

## Project info

**URL**: https://lovable.dev/projects/REPLACE_WITH_PROJECT_ID

## How can I edit this code?

There are several ways of editing your application.

**Use Lovable**

Simply visit the [Lovable Project](https://lovable.dev/projects/REPLACE_WITH_PROJECT_ID) and start prompting.

Changes made via Lovable will be committed automatically to this repo.

**Use your preferred IDE**

If you want to work locally using your own IDE, you can clone this repo and push changes. Pushed changes will also be reflected in Lovable.

The only requirement is having Node.js & npm installed - [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating)

Follow these steps:

```sh
# Step 1: Clone the repository using the project's Git URL.
git clone <YOUR_GIT_URL>

# Step 2: Navigate to the project directory.
cd <YOUR_PROJECT_NAME>

# Step 3: Install the necessary dependencies.
npm i

# Step 4: Start the development server with auto-reloading and an instant preview.
npm run dev
```

`npm run dev` inicia frontend (Vite) e backend API em paralelo.
Se preferir executar separadamente:

```sh
npm run dev:api   # API em http://localhost:3000
npm run dev:ui    # Frontend em http://localhost:8080
```

**Edit a file directly in GitHub**

- Navigate to the desired file(s).
- Click the "Edit" button (pencil icon) at the top right of the file view.
- Make your changes and commit the changes.

**Use GitHub Codespaces**

- Navigate to the main page of your repository.
- Click on the "Code" button (green button) near the top right.
- Select the "Codespaces" tab.
- Click on "New codespace" to launch a new Codespace environment.
- Edit files directly within the Codespace and commit and push your changes once you're done.

## What technologies are used for this project?

This project is built with:

- Vite
- TypeScript
- React
- shadcn-ui
- Tailwind CSS

## How can I deploy this project?

Simply open [Lovable](https://lovable.dev/projects/REPLACE_WITH_PROJECT_ID) and click on Share -> Publish.

## Can I connect a custom domain to my Lovable project?

Yes, you can!

To connect a domain, navigate to Project > Settings > Domains and click Connect Domain.

Read more here: [Setting up a custom domain](https://docs.lovable.dev/features/custom-domain#custom-domain)

## Backend / Railway

Operational backend instructions (Postgres, PGFN sync job, cron e variáveis) estão em:

- `RAILWAY_RUNBOOK.md`

## Compliance Ambiental (multiagentes)

- Endpoint: `POST /api/environmental-compliance`
- Endpoint de evidência visual (robô Playwright): `POST /api/areas-contaminadas/screenshot`
- Healthcheck de fontes: `GET /api/sources/health`
- Fluxo atual (7 agentes): CNPJ/CNAE -> RAG CNAE x FTE -> Federal -> Estadual -> Municipal -> Areas Contaminadas -> Relatorio IA auditavel
- Schema de resposta atual: `schema_version: "br-v1"`
- Campos-chave de auditoria: `jurisdiction_context`, `coverage`, `evidence`, `areas_contaminadas` (estruturado + embed oficial)
- Reuso inteligente por CNPJ: por padrão, consultas repetidas em até 30 dias reaproveitam a última análise para economizar token/infra.
- Variaveis recomendadas:
  - `PORTAL_TRANSPARENCIA_API_KEY` (gov.br)
  - `DATABASE_URL` (Postgres para persistência durável)
  - `ENV_COMPLIANCE_REUSE_WINDOW_DAYS` (opcional, default `30`)
  - `ENV_COMPLIANCE_REUSE_ENABLED` (opcional, default `true`)
  - `OPENAI_FTE_VECTOR_STORE_ID` (RAG CNAE x FTE)
  - `OPENAI_API_KEY` (habilita o agente final de relatorio IA)
  - `OPENAI_MODEL` (opcional, default `gpt-4o-mini`)
  - `OPENAI_FTE_MODEL` (opcional, default `OPENAI_MODEL`)
  - `OPENAI_FTE_RAG_TIMEOUT_MS` (opcional, default `18000`; orçamento do agente RAG)
  - `OPENAI_FTE_RAG_RETRY_TIMEOUT_MS` (opcional, default `0`; retry adicional do RAG)
  - `OPENAI_RELATORIO_TIMEOUT_MS` (opcional, default `15000`; orçamento do relatório IA)

## Investigação profunda (PJ -> PF -> PJ)

- A API `POST /api/analyze-cnpj` agora dispara automaticamente uma investigação profunda em background
  e retorna `meta.deep_investigation.run_id`.
- Endpoints de acompanhamento:
  - `GET /api/investigations/:run_id`
  - `GET /api/investigations/:run_id/graph`
  - `GET /api/investigations/:run_id/events?cursor=0`
  - `GET /api/investigations/:run_id/judicial/coverage`
  - `GET /api/investigations/:run_id/judicial/processes`
  - `GET /api/investigations/:run_id/judicial/summary`
