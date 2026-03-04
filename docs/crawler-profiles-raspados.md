# Perfis de crawler raspados dos sites (por nome e CNPJ)

Documento gerado por raspagem real das páginas de consulta pública. **Sem DataJud.** Uso direto em crawlers (request GET/POST + campos exatos).

---

## 1. ESAJ (1º grau — cpopg)

**Base por tribunal:** `https://esaj.<tribunal>.jus.br`  
Ex.: TJSP = `https://esaj.tjsp.jus.br`

### URL do formulário
- **Abrir formulário:** `GET /cpopg/open.do`
- **Enviar busca:** `GET /cpopg/search.do` (mesmo host)

### Método
**GET** (não precisa de ViewState).

### Parâmetros da busca (query string)

| Parâmetro | Obrigatório | Valor | Observação |
|-----------|-------------|--------|------------|
| `cbPesquisa` | sim | `NMPARTE` \| `DOCPARTE` \| `NUMPROC` \| `NMADVOGADO` \| `NUMOAB` \| `PRECATORIA` \| `DOCDELEG` \| `NUMCDA` | NMPARTE = nome da parte, DOCPARTE = documento (CNPJ/CPF) |
| `dadosConsulta.tipoNuProcesso` | sim | `UNIFICADO` | Fixo para busca por parte/documento |
| `dadosConsulta.valorConsulta` | sim | valor da busca | Nome (ex.: "Empresa XYZ") ou CNPJ 14 dígitos sem pontuação |
| `cdForo` | sim | `-1` | Todos os foros |
| `conversationId` | não | `` | Vazio |
| `paginaConsulta` | paginação | `1`, `2`, ... | Só a partir da página 2 |

### Exemplo de URL (por nome)
```
https://esaj.tjsp.jus.br/cpopg/search.do?cbPesquisa=NMPARTE&dadosConsulta.tipoNuProcesso=UNIFICADO&dadosConsulta.valorConsulta=Empresa+XYZ&cdForo=-1&conversationId=
```

### Exemplo de URL (por CNPJ)
```
https://esaj.tjsp.jus.br/cpopg/search.do?cbPesquisa=DOCPARTE&dadosConsulta.tipoNuProcesso=UNIFICADO&dadosConsulta.valorConsulta=12345678000199&cdForo=-1&conversationId=
```

### Campos no HTML (referência)
- **Form:** `name="consultarProcessoForm"`, `id="formConsulta"`, `action="/cpopg/search.do"`, `method="GET"`.
- **Select tipo de pesquisa:** `name="cbPesquisa"`, `id="cbPesquisa"`.
- **Campo valor (1º grau):** `name="dadosConsulta.valorConsulta"`; para NMPARTE/DOCPARTE o input visível tem `id="campo_NMPARTE"` ou `id="campo_DOCPARTE"` (habilitado via JS conforme `cbPesquisa`).
- **Foro:** `name="cdForo"`, `id="comboForo"`, valor `-1`.
- **Submit:** `id="botaoConsultarProcessos"`, `value="Consultar"`.

### Paginação (listagem)
- **Trocar página:** `GET /cpopg/trocarPagina.do` com os mesmos parâmetros + `paginaConsulta=N`.

### Observações
- Pode aparecer **captcha**; em caso de bloqueio, marcar `unavailable` e não tentar bypass.
- **CSRF:** há `_csrf` no HTML; para GET o uso em produção pode não exigir (testar).

---

## 2. ESAJ (2º grau — cposg)

**Base:** mesmo host `https://esaj.<tribunal>.jus.br`.

### URL
- **Formulário:** `GET /cposg/open.do`
- **Busca:** `GET /cposg/search.do`

### Parâmetros (diferentes do 1º grau)

| Parâmetro | Valor |
|-----------|--------|
| `cbPesquisa` | `NMPARTE` \| `DOCPARTE` \| ... (mesmos valores) |
| `dePesquisa` | valor da busca (nome ou CNPJ) — **nome diferente do 1º grau** |
| `dadosConsulta.localPesquisa.cdLocal` | `-1` |
| `tipoNuProcesso` | `UNIFICADO` (quando aplicável) |
| `paginaConsulta` | `0` ou `1`, `2`, ... para paginação |

No 2º grau o campo de valor da pesquisa é **`dePesquisa`**, e o foro é **`localPesquisa.cdLocal`** (valor `-1`).

### Exemplo (por nome, 2º grau)
```
https://esaj.tjsp.jus.br/cposg/search.do?cbPesquisa=NMPARTE&dadosConsulta.tipoNuProcesso=UNIFICADO&dePesquisa=Empresa+XYZ&dadosConsulta.localPesquisa.cdLocal=-1
```

### Campos no HTML (cposg)
- **Form:** `id="formularioConsulta"`, `action="/cposg/search.do"`, `method="GET"`.
- **Valor da pesquisa:** `name="dePesquisa"`, `id="campo_NMPARTE"` / `id="campo_DOCPARTE"` conforme `cbPesquisa`.
- **Foro:** `name="localPesquisa.cdLocal"`, `id="comboForo"`, valor `-1`.

---

## 3. PJe (ex.: TRF1 Consulta Pública)

**URL base (TRF1):** `https://pje1g-consultapublica.trf1.jus.br/consultapublica/ConsultaPublica/listView.seam`  
Outros tribunais: trocar host; path costuma ser `.../ConsultaPublica/listView.seam` ou `.../primeirograu/ConsultaPublica/listView.seam`.

### Método
**POST** (JSF/RichFaces). É obrigatório:
1. **GET** na página para obter `javax.faces.ViewState` e cookies (jsessionid).
2. **POST** para o mesmo URL com todos os campos do form + ViewState.

### Nomes de campos (raspados do TRF1 — fev/2026)

| Busca por | name do input | id (referência) |
|-----------|----------------|------------------|
| **Número do processo** | `fPP:numProcesso-inputNumeroProcessoDecoration:numProcesso-inputNumeroProcesso` | `fPP:numProcesso-inputNumeroProcessoDecoration:numProcesso-inputNumeroProcesso` |
| **Nome da parte** | `fPP:dnp:nomeParte` | `fPP:dnp:nomeParte` |
| **CPF/CNPJ (documento)** | `fPP:dpDec:documentoParte` | `fPP:dpDec:documentoParte` |
| Nome do advogado | `fPP:j_id184:nomeAdv` | `fPP:j_id184:nomeAdv` |
| Classe judicial | `fPP:j_id193:classeJudicial` | `fPP:j_id193:classeJudicial` |
| OAB número | `fPP:Decoration:numeroOAB` | `fPP:Decoration:numeroOAB` |
| OAB UF | `fPP:Decoration:estadoComboOAB` | `fPP:Decoration:estadoComboOAB` |
| Processo referência | `fPP:j_id166:processoReferenciaInput` | — |

### Botão de pesquisa
- **name:** `fPP:searchProcessos`
- **value:** `Pesquisar` (ou o texto do botão)
- **tipo:** button (enviar como name=value no POST).

### Form
- **id/name:** `fPP` (form principal da consulta).
- **action:** `/consultapublica/ConsultaPublica/listView.seam` (relativo ao host).
- **method:** POST.

### Hidden obrigatórios (incluir no POST)
- `javax.faces.ViewState` — valor obtido do GET (ex.: `j_id1` ou valor longo).
- Demais hiddens do form (ex.: `fPP`, `fPP:_link_hidden_`, `fPP:j_idcl`, etc.) com os valores retornados na página.

### Máscara documento (CPF vs CNPJ)
- No HTML há rádios `tipoMascaraDocumento`: CPF ou CNPJ. Para crawler, enviar o número **sem pontuação** (14 dígitos CNPJ, 11 CPF); o backend costuma aceitar só dígitos.

### Exemplo de fluxo (por CNPJ)
1. `GET https://pje1g-consultapublica.trf1.jus.br/consultapublica/ConsultaPublica/listView.seam`
2. Extrair do HTML: `javax.faces.ViewState`, cookie `JSESSIONID`.
3. `POST` mesmo URL, `Content-Type: application/x-www-form-urlencoded`, body com:
   - todos os hidden do form;
   - `fPP:dpDec:documentoParte` = `12345678000199`;
   - `fPP:searchProcessos` = `Pesquisar`.
4. Parsear a resposta (tabela de processos, ex.: `id="fPP:processosTable"`).

### Observações
- **IDs dinâmicos:** `j_id184`, `j_id193` etc. podem variar entre instalações; os **nomes** `fPP:dnp:nomeParte` e `fPP:dpDec:documentoParte` tendem a ser estáveis (mesma árvore JSF).
- **Captcha:** PJe pode exibir hCaptcha/reCAPTCHA; nesse caso marcar unavailable.
- **Hosts por tribunal:** usar a URL de consulta pública de cada tribunal (ex.: TRT2 pode redirecionar para login; TRF1 tem subdomínio dedicado `pje1g-consultapublica.trf1.jus.br`).

---

## 4. eproc (TJRS, TJSC, TRF4, TJMS, TJTO)

**URL típica:**  
`https://eproc1g.tjrs.jus.br/eproc/externo_controlador.php?acao=processo_consulta_publica`  
(Variar host por tribunal; `acao=processo_consulta_publica` é padrão.)

Sites eproc costumam dar timeout ou exigir sessão. Quando a página carregar, o formulário costuma ter:
- Campo **documento** (CPF/CNPJ);
- Campo **nome da parte**;
- Action para `externo_controlador.php` com `acao` de pesquisa.

Para usar em crawler: raspar o form da página real (curl/Playwright) e preencher documento e nome conforme os `name` encontrados; enviar POST com todos os hiddens.

---

## Resumo para implementação

| Família | Método | Por nome | Por CNPJ | Observação |
|---------|--------|----------|----------|------------|
| **ESAJ 1º (cpopg)** | GET | `cbPesquisa=NMPARTE` + `dadosConsulta.valorConsulta=<nome>` | `cbPesquisa=DOCPARTE` + `dadosConsulta.valorConsulta=<14 dígitos>` | cdForo=-1 |
| **ESAJ 2º (cposg)** | GET | `cbPesquisa=NMPARTE` + `dePesquisa=<nome>` | `cbPesquisa=DOCPARTE` + `dePesquisa=<14 dígitos>` | localPesquisa.cdLocal=-1 |
| **PJe** | POST (JSF) | `fPP:dnp:nomeParte=<nome>` | `fPP:dpDec:documentoParte=<14 dígitos>` | Obter ViewState + cookies antes |

Arquivo de base de tribunais e URLs: `docs/tribunais-consulta-publica.tsv`.
