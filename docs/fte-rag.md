# FTE + RAG (OpenAI File Search)

Este projeto possui pipeline para:

1. Baixar as FTEs oficiais do IBAMA (paginas de FTE e documentos SEI vinculados)
2. Gerar arquivos `.md` prontos para indexacao em RAG
3. Subir os arquivos para OpenAI Vector Store (File Search)

## 1) Download das FTEs

```bash
npm run fte:download
```

Opcoes:

- `--max-pages=20` limita a quantidade de paginas de FTE processadas
- `--out-dir=data/fte` define diretorio de saida
- `--no-sei` nao baixa documentos SEI vinculados
- `--force` baixa novamente mesmo que arquivo ja exista

Saidas principais:

- `data/fte/raw/fte-pages/*.html`
- `data/fte/raw/sei-docs/*.html`
- `data/fte/rag/*.md`
- `data/fte/manifest/summary.json`
- `data/fte/manifest/fte-pages.json`
- `data/fte/manifest/sei-docs.json`

## 2) Upload para OpenAI File Search

Variaveis:

- `OPENAI_API_KEY` obrigatoria
- `OPENAI_VECTOR_STORE_ID` opcional (se ja existir)

Criar vector store automaticamente e subir:

```bash
OPENAI_API_KEY=... npm run fte:rag:upload -- --create-vector-store --vector-store-name="FTE Ambiental"
```

Usar vector store existente:

```bash
OPENAI_API_KEY=... OPENAI_VECTOR_STORE_ID=vs_xxx npm run fte:rag:upload
```

Dry-run (sem upload):

```bash
OPENAI_API_KEY=... npm run fte:rag:upload -- --dry-run
```

Manifesto de upload:

- `data/fte/manifest/openai-filesearch-upload.json`

