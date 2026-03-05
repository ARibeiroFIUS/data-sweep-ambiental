# Super Relatório AI (Projeto Novo)

Aplicação separada para gerar relatório executivo de compliance ambiental com OpenAI, usando os dados já coletados pelo DataSweep.

## Endpoints

- `GET /health`
- `POST /api/super-report`

Payload:

```json
{
  "cnpj": "03171752000103"
}
```

## Variáveis

Copie `.env.example` e configure:

- `OPENAI_API_KEY` (obrigatória)
- `OPENAI_MODEL` (padrão: `gpt-4.1`)
- `DATASWEEP_API_URL` (padrão: `https://data-sweep-engine-web-production.up.railway.app`)
- `PORT` (opcional)

## Rodar local

```bash
cd super-relatorio-ai
npm install
npm run dev
```

Abra `http://localhost:3000`.

## Deploy no Railway (projeto novo)

No diretório raiz já está vinculado ao projeto Railway `data-sweep-super-relatorio-ai`.
Para subir só este app, use:

```bash
railway up super-relatorio-ai --path-as-root
```

Depois configure variáveis no serviço `web`:

- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `DATASWEEP_API_URL`

