# Caminhos para busca de processos por nome e por CNPJ

Referência consolidada dos **caminhos (URLs, parâmetros e APIs)** para consulta pública de processos judiciais **por nome da parte** e **por CNPJ/CPF**, por família de sistema e por fonte.

---

## 1. DataJud (API CNJ) — recomendado quando disponível

**Fonte:** [API Pública DataJud](https://datajud-wiki.cnj.jus.br/api-publica/endpoints/)  
**Autenticação:** `Authorization: APIKey <chave>` (chave no [wiki de acesso](https://datajud-wiki.cnj.jus.br/api-publica/acesso/)).

- **Base:** `https://api-publica.datajud.cnj.jus.br/`
- **Endpoint por tribunal:** `https://api-publica.datajud.cnj.jus.br/api_publica_<tribunal>/_search`
- **Método:** POST, body JSON (Elasticsearch-like).

### Por CNPJ

- **Campo no body:** `partes.documento`, `partes.documento.keyword`, `poloAtivo.documento`, `poloPassivo.documento`.
- **Valor:** CNPJ com 14 dígitos (sem formatação).
- **Exemplo (trecho):** `query.bool.should`: `{ "term": { "partes.documento": "12345678000199" } }`.

### Por nome da parte

- **Campos no body:** `partes.nome`, `poloAtivo.nome`, `poloPassivo.nome`.
- **Tipo de query:** `match_phrase` ou `query_string` com o nome.
- **Recomendação CNJ:** preferir CNPJ/CPF quando possível (evitar homônimos).

Lista completa de tribunais e aliases: [Endpoints DataJud](https://datajud-wiki.cnj.jus.br/api-publica/endpoints/).

---

## 2. ESAJ (TJSP e outros TJs)

**Consulta 1º grau (cível):** `cpopg`  
**Consulta 2º grau:** `cposg`

### URLs base

| Escopo | Página inicial | Submit da busca |
|--------|----------------|------------------|
| 1º grau | `https://esaj.<tribunal>.jus.br/cpopg/open.do` | `https://esaj.<tribunal>.jus.br/cpopg/search.do` |
| 2º grau | `https://esaj.<tribunal>.jus.br/cposg/open.do` | `https://esaj.<tribunal>.jus.br/cposg/search.do` |

Exemplo TJSP 1º grau: [esaj.tjsp.jus.br/cpopg/open.do](https://esaj.tjsp.jus.br/cpopg/open.do).

### Parâmetros da busca (GET ou POST para `search.do`)

| Modo | Parâmetro `cbPesquisa` | Valor da busca (1º grau) | Valor da busca (2º grau) |
|------|------------------------|--------------------------|---------------------------|
| **Por nome da parte** | `NMPARTE` | `dadosConsulta.valorConsulta` | `dePesquisa` |
| **Por documento (CNPJ/CPF)** | `DOCPARTE` | `dadosConsulta.valorConsulta` | `dePesquisa` |
| Número do processo | `NUMPROC` | `dadosConsulta.valorConsulta` | `dePesquisa` |
| Nome do advogado | `NMPARTE` (contexto advogado) | — | — |
| OAB | `OAB` | — | — |

Outros parâmetros comuns: `conversationId`, `dadosConsulta.tipoNuProcesso=UNIFICADO`, `cdForo=-1`, `uuidCaptcha`, `paginaConsulta` (paginação).

### Observações

- **Nome:** pesquisa fonética; aceita nome completo ou parcial; não exige acentos/maiúsculas.
- **Documento:** número completo, sem pontos, traços ou barras (ex.: 14 dígitos para CNPJ).
- **Captcha:** muitas consultas exibem captcha; em caso de bloqueio, marcar `unavailable` e não forçar bypass.

---

## 3. PJe (TRFs, TRTs, TJs, TREs)

**URL típica de consulta pública:**  
`https://<host>/<path>/ConsultaPublica/listView.seam`

Exemplos:

- TRF1: `https://pje1g-consultapublica.trf1.jus.br/consultapublica/ConsultaPublica/listView.seam`
- TRT2: `https://pje.trt2.jus.br/primeirograu/ConsultaPublica/listView.seam`
- TJBA: `https://pje.tjba.jus.br/pje/ConsultaPublica/listView.seam`

### Campos de busca (formulário na tela)

| Tipo de busca | Uso no formulário |
|---------------|-------------------|
| **CNPJ/CPF** | Campo “CPF/CNPJ” (documento da parte) |
| **Nome da parte** | Campo “Nome da parte” (completo ou parcial) |
| Número do processo | “Número do processo” (podem bastar os 7 primeiros dígitos) |
| Nome do advogado | “Nome do advogado” |
| Numeração única CNJ | “Numeração única” |
| Outros | Assunto, classe, órgão julgador, data, valor, movimento etc. |

Referência: [PJe – Consulta pública (dicas)](https://pjeje.github.io/dicas/consulta/publica/), [Pesquisa de processos (TJMG)](https://www8.tjmg.jus.br/institucional/estrutura_organizacional/PJe/Pesquisadeprocessos.html).

### Implementação no projeto

- O conector **genérico** (`judicial-generic-connectors.mjs`) descobre formulários na página, identifica campos por nome (cnpj/cpf/documento/parte para CNPJ; nome/parte/autor/réu para nome) e monta o POST.
- Hosts alternativos por tribunal em `PJE_HOST_ALIASES` (ex.: trt2 → trtsp, tjrj → tjrj.pje.jus.br).

---

## 4. eproc (TRF4, TJMS, TJRS, TJSC, TJTO)

**URL base por tribunal (exemplos):**

- TRF4: `https://eproc.trf4.jus.br/eproc2trf4/externo_controlador.php?acao=processo_consulta_publica`
- TJRS: `https://eproc1g.tjrs.jus.br/eproc/externo_controlador.php?acao=processo_consulta_publica`
- TJSC: `https://eproc1g.tjsc.jus.br/eproc/externo_controlador.php?acao=processo_consulta_publica`

**Observação:** No TRF4 a consulta pública via eproc pode estar desativada; há links para consulta “sem chave” e “por chave” em outros domínios (ex.: `www2.trf4.jus.br`).

### Opções de busca (geral no eproc)

- Número do processo  
- **CNPJ da parte** (pessoas jurídicas)  
- **Nome da parte**  
- CPF (pessoas físicas)  
- Chave do processo  
- OAB do advogado  
- Assunto  

Base por tribunal no código: `EPROC_BASE_BY_TRIBUNAL` em `judicial-generic-connectors.mjs`. O conector genérico pode ser usado para preencher formulários de consulta quando a página estiver disponível.

---

## 5. Projudi (TJPR)

**URL:** `https://projudi.tjpr.jus.br/projudi/`  
**Consulta unificada (portal):** [Consulta Processual Unificada - TJPR](https://www.tjpr.jus.br/consulta-processual-unificada)

### Critérios de busca

- **Nome de um dos interessados** (autor ou réu)  
- **CPF ou CNPJ**  
- Comarca e Juízo  
- Nome do advogado  
- Número do processo  

Restrições: processos de família (sigilosos); criminais só por número processual; processos arquivados podem não ser consultáveis.

---

## 6. TSE — Consulta Pública Unificada (PJe Eleitoral)

**URL:** [consultaunificadapje.tse.jus.br](https://consultaunificadapje.tse.jus.br/)

A Justiça Eleitoral usa essa **consulta unificada** (não a tela padrão de Consulta Pública do PJe de cada instância). Permite pesquisa por:

- Número do processo  
- **Nome das partes**  
- Dados do advogado  
- Outros filtros  

Uma única busca abrange todas as instâncias (TREs + TSE). Referência: [PJe – Consulta pública (TSE)](https://pjeje.github.io/dicas/consulta/publica/).

---

## Resumo por família

| Família   | Por CNPJ | Por nome | Observação |
|-----------|----------|----------|------------|
| **DataJud** | POST `_search` com `partes.documento` etc. | POST `_search` com `partes.nome` etc. | API; preferir quando disponível. |
| **ESAJ**  | `cbPesquisa=DOCPARTE` + `dadosConsulta.valorConsulta` (cpopg) ou `dePesquisa` (cposg) | `cbPesquisa=NMPARTE` + mesmo campo de valor | Captcha frequente. |
| **PJe**   | Campo “CPF/CNPJ” no form em `listView.seam` | Campo “Nome da parte” no form | Um URL por tribunal; conector genérico. |
| **eproc** | Formulário “CNPJ da parte” / documento | Formulário “Nome da parte” | Alguns tribunais desativam consulta pública. |
| **Projudi** | CPF/CNPJ na consulta unificada TJPR | Nome do interessado | Restrições para família/criminal. |
| **TSE**   | Via consulta unificada | Nome das partes | Um ponto único para toda a JE. |

---

## Uso no projeto (data-sweep-engine)

- **DataJud:** `server/datajud-query.mjs` — `buildSearchBody` (CNPJ), `buildSearchBodyByName` (nome); `queryDatajudTribunal({ queryMode: 'cnpj_exact' | 'party_name', ... })`.
- **ESAJ:** `server/judicial-connectors.mjs` — `buildEsajSearchQuery`, `buildEsajBaseUrl`, modo `DOCPARTE` (CNPJ) ou `NMPARTE` (nome); escopos `cpopg` / `cposg`.
- **PJe / eproc / Projudi:** `server/judicial-generic-connectors.mjs` — descoberta de formulários e campos; `scoreFormForQuery`, `pickTargetFields` para `cnpj_exact` e `party_name`.
- **Catálogo de tribunais e modos:** `server/judicial-catalog.mjs` — `query_modes_supported_json` por tribunal (ex.: `cnpj_exact`, `party_name`, `process_number`).

Para **descobrir/validar** telas e seletores por tribunal, use o kit Playwright: `npm run tribunal:capture`, `npm run tribunal:codegen` e a base `docs/tribunais-consulta-publica.tsv`.
