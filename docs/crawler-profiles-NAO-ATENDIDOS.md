# Perfis de crawler — tribunais que o sistema NÃO atende hoje

Documento com o código/URLs/campos **raspados dos sites** dos tribunais que hoje dependem de conector genérico ou custom e **não têm crawler específico**.  
Foco: **eproc**, **Projudi (TJPR)** e **TREs (custom)**.  
*(ESAJ e PJe já têm conector próprio e não entram aqui.)*

---

## Resumo: quem NÃO é atendido

| Família   | Tribunais | Status da raspagem |
|-----------|-----------|----------------------|
| **eproc** | TRF4, TJMS, TJRS, TJSC, TJTO | Sites deram timeout/bloqueio; estrutura documentada abaixo. |
| **projudi** | TJPR | **Raspado.** URL e formulário completos abaixo. |
| **custom** | 27 TREs | Páginas TRE (ex.: tre-sp) retornaram 404; pode ser TSE unificada ou link por tribunal. |

---

## 1. Projudi (TJPR) — raspado

O sistema usa hoje `projudi.tjpr.jus.br/projudi/`, mas a **consulta pública real** está em **`projudi_consulta`** (com underscore).

### URL correta da consulta pública
- **Entrada (com frames):** `https://projudi.tjpr.jus.br/projudi_consulta/`
- **Formulário (conteúdo do frame):** `https://projudi.tjpr.jus.br/projudi_consulta/processo/consultaPublica.do?actionType=iniciar`
- **Submit da busca:** `POST` para `https://projudi.tjpr.jus.br/projudi_consulta/processo/consultaPublica.do?actionType=pesquisar`

### Form (raspado do HTML)
- **name/id:** `processoBuscaForm` / `buscaProcessoForm`
- **method:** POST  
- **action:** `/projudi_consulta/processo/consultaPublica.do?actionType=pesquisar` (relativo ao host)

### Campos para busca por nome e por CNPJ

| Campo | name | Observação |
|-------|------|------------|
| **Nome da parte** | `nomeParte` | input text, size 40 |
| **CPF/CNPJ** | `cpfCnpj` | input text, size 25 (só dígitos) |
| **Número do processo** | `numeroProcesso` | quando opção = por número |
| **Comarca** | `codComarca` | select, obrigatório para busca por parte; valor `-1` = "Selecione Para Busca" |
| **Juízo/Vara** | `codVara` | select, depende da comarca (pode vir vazio) |
| **Nome do advogado** | `nomeAdvogado` | input text |
| **OAB** | `oab`, `oabComplemento`, `oabUF` | opcional |

### Tipo de consulta (opção)
- **Radio:** `opcaoConsultaPublica` — valor `1` = por número do processo; valor `2` = por nome/CPF/CNPJ/comarca.
- **Hidden:** `opcaoConsultaPublicaHidden` — preenchido via JS com o valor da opção escolhida.
- Para **nome ou CNPJ** usar `opcaoConsultaPublica=2` e preencher `nomeParte` e/ou `cpfCnpj` e `codComarca` (obrigatório).

### Hidden obrigatórios (enviar no POST)
- `processoPageSize` = 20  
- `processoPageNumber` = 1  
- `processoSortColumn` = p.numeroUnico  
- `processoSortOrder` = asc  
- `codVaraEscolhida` = (vazio ou valor)  
- `flagNumeroUnicoHidden` = true/false (quando for por número)  
- `codTribunal` = 1 (TJPR)

### Captcha
- Imagem: `GET /projudi_consulta/captcha` (session-bound).  
- Campo de resposta: `name="answer"`.  
- Sem resolver captcha a pesquisa não é aceita; em caso de bloqueio, marcar tribunal como `unavailable` e não forçar bypass.

### Restrições (do site)
- Processos de família: sigilosos, não aparecem na consulta pública.  
- Criminais: só por número do processo; não por nome/advogado.  
- Criminais arquivados: não consultáveis.

---

## 2. eproc (TRF4, TJMS, TJRS, TJSC, TJTO)

Os acessos diretos aos sites eproc (curl/fetch) deram **timeout ou resposta vazia** no ambiente de raspagem. Abaixo fica a **estrutura conhecida** para quando o site responder.

### URLs de consulta pública (por tribunal)
- **TRF4:** `https://eproc.trf4.jus.br/eproc2trf4/externo_controlador.php?acao=processo_consulta_publica` (no TRF4 a consulta pública pode estar desativada)
- **TJMS:** `https://eproc.tjms.jus.br/eprocV2/externo_controlador.php?acao=processo_consulta_publica`
- **TJRS:** `https://eproc1g.tjrs.jus.br/eproc/externo_controlador.php?acao=processo_consulta_publica`
- **TJSC:** `https://eproc1g.tjsc.jus.br/eproc/externo_controlador.php?acao=processo_consulta_publica`
- **TJTO:** `https://eproc1g.tjto.jus.br/eprocV2_prod_1grau/externo_controlador.php?acao=processo_consulta_publica`

### Estrutura típica (documentação e outros tribunais)
- **Action:** `externo_controlador.php` com `acao=processo_consulta_publica` (e às vezes ação de pesquisar no submit).
- Campos comuns em sistemas eproc: **número do processo**, **chave do processo**, e em alguns **documento (CPF/CNPJ)** e **nome da parte**.
- Consulta pública em alguns eprocs é **só por número**; quando houver nome/documento, vêm em inputs do form.

### Como obter o código exato
- Com **Playwright** (ou navegador): abrir a URL do tribunal, inspecionar o `<form>`, pegar `action`, `method` e todos os `name` dos inputs.
- Usar `npm run tribunal:capture` / `tribunal:codegen` com a URL do tribunal para gerar evidência (HTML + HAR) e extrair o profile.

---

## 3. TREs (custom — 27 tribunais)

Cada TRE tem link do tipo `https://www.tre-<uf>.jus.br/servicos-judiciais/pje/consulta-processual`. No teste, **TRE-SP** retornou “Página não encontrada”; pode ter mudado de path ou redirecionar para a **Consulta Unificada PJe (TSE)**.

### Opções para crawler
- **Consulta Unificada TSE:** `https://consultaunificadapje.tse.jus.br/` — um único ponto para toda a Justiça Eleitoral (TREs + TSE). Se os TREs redirecionarem para lá, o crawler pode usar só essa URL e filtrar por tribunal/UF na resposta.
- **Por tribunal:** Se cada TRE tiver tela própria, raspar com Playwright a URL `https://www.tre-<uf>.jus.br/...` (ou a que estiver ativa) e documentar form/parâmetros.

---

## Ajuste no código: URL do Projudi (TJPR)

O conector genérico hoje usa:
- `https://projudi.tjpr.jus.br/projudi/consultaPublica.do?actionType=iniciar`
- `https://projudi.tjpr.jus.br/projudi/`

A consulta pública que contém o formulário por **nome e CNPJ** está em:
- `https://projudi.tjpr.jus.br/projudi_consulta/`
- `https://projudi.tjpr.jus.br/projudi_consulta/processo/consultaPublica.do?actionType=iniciar`

Recomendação: **atualizar** `buildProjudiCandidates` em `server/judicial-generic-connectors.mjs` para incluir essas URLs (e priorizar `projudi_consulta`).

---

## Checklist para “go live” dos não atendidos

1. **Projudi:** Usar URL e campos acima; implementar fluxo com captcha (ou marcar unavailable quando captcha bloquear).  
2. **eproc:** Com Playwright ou quando o site responder, raspar form de um tribunal (ex.: TJRS) e replicar para os outros pela mesma família.  
3. **TRE:** Confirmar se há redirect para TSE unificada; se sim, um único profile; se não, um profile por TRE a partir da raspagem da página ativa.
