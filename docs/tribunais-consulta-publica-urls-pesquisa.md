# Pesquisa: URLs de consulta pública por tribunal (fontes web)

Pesquisa feita em 2026-03-01 para corrigir tribunais com erro (404, ERR_NAME_NOT_RESOLVED, path errado).  
Fonte de verdade para o engine: `docs/tribunais-consulta-publica-92.tsv`.

## Correções aplicadas (TSV + código)

| Tribunal | Antes | Depois | Fonte |
|----------|--------|--------|--------|
| **TJAP** | `pje.tjap.jus.br/primeirograu/...` | `pje.tjap.jus.br/1g/ConsultaPublica/listView.seam` | [Segunda Via de Tudo](https://www.segundaviadetudo.com.br/tjap-pje/), [Processo Rápido](https://blog.processorapido.com/como-consultar-processo-tjap-amapa/) |
| **TJRN** | `pje.tjrn.jus.br/primeirograu/...` | `pje1g.tjrn.jus.br/pje/ConsultaPublica/listView.seam` | [PJe 1º Grau TJRN](https://pje1g.tjrn.jus.br/pje/home.seam), padrão TRF1 (pje1g.*/pje/ConsultaPublica) |
| **TJTO** | `eproc1g.tjto.jus.br/...` | `eproc1.tjto.jus.br/...` (host **eproc1** sem "g") | [Segunda Via de Tudo TJTO](https://www.segundaviadetudo.com.br/tjto-eproc/) |
| **TJAL** | `esaj.tjal.jus.br/cpopg/open.do` | `www2.tjal.jus.br/cpopg/open.do` | [e-SAJ TJAL](https://www2.tjal.jus.br/cpopg/search.do) – CPOPG oficial em www2 |
| **TRF6** | `pje.trf6.jus.br/pje/ConsultaPublica/listView.seam` | `pje1g.trf6.jus.br/consultapublica/ConsultaPublica/listView.seam` | Host de 1º grau com consulta pública ativa (captura 200) |
| **TJPI** | `tjpi.pje.jus.br/1g/ConsultaPublica/listView.seam` | `www.tjpi.jus.br/e-tjpi/home/consulta` | e-TJPI com formulário público por parte/documento (captura 200) |
| **TJGO** | `pje.tjgo.jus.br/pje/ConsultaPublica/listView.seam` | `projudi.tjgo.jus.br/BuscaProcesso?PaginaInicial` | Projudi público carregando com formulário e Turnstile |
| **TJSE** | `pje.tjse.jus.br/pje/ConsultaPublica/listView.seam` | `interface-consultaprocessual.tjse.jus.br/consultaprocessual/` | Página oficial embutida no portal TJSE; acesso protegido por challenge |

## Outros tribunais (referência para manutenção)

- **TJES**: PJe em `pje.tjes.jus.br`; “Acompanhamento Processual Simplificado” em `aplicativos.tjes.jus.br/consultaunificada` (não inclui PJe). Redirecionamento para base CNJ é política do portal.
- **TJMT**: Consulta processual em `consultaprocessual.tjmt.jus.br` (já em uso). Outro sistema: `cia.tjmt.jus.br/Publico/ConsultaPublica/Index.aspx` (processo administrativo).
- **TJMS**: Consulta pública 1º grau e-SAJ: `esaj.tjms.jus.br/cpopg5/open.do`. **Ajuste aplicado**: connector eproc→esaj, URL e-SAJ; suporte a cpopg5 em `judicial-connectors.mjs`. Teste local: 200, formulário.
- **TJPI**: passou a usar `www.tjpi.jus.br/e-tjpi/home/consulta` (consulta pública com busca por parte/CPF-CNPJ). Em validação local, retorna 200 com formulário.
- **TRT1**: Subdomínios citados: `consultapje.trt1.jus.br`, `pje.trt1.jus.br`. Redirecionamento para login é do portal; não há URL de consulta pública sem login confirmada.
- **TJPA**: Portal em www.tjpa.jus.br; PJe consulta pode exigir navegação a partir do portal (page crash no ambiente de captura).
- **TRF4**: Consulta pública desativada no portal (`public_query_disabled`).
- **STJ, TJRO, TJRS**: Bloqueio/WAF (access_blocked); não há URL alternativa pública documentada.

## Validação local (2026-03-01)

| Tribunal | URL aplicada | Resultado captura |
|----------|--------------|-------------------|
| TJAP (1g) | `pje.tjap.jus.br/1g/ConsultaPublica/listView.seam` | HTTP 200, formulário consulta pública |
| TJAL (www2) | `www2.tjal.jus.br/cpopg/open.do` | HTTP 200, e-SAJ 1º grau |
| TJMS (esaj cpopg5) | `esaj.tjms.jus.br/cpopg5/open.do` | HTTP 200, e-SAJ 1º grau (1 form, 25 inputs); conector alterado eproc→esaj |
| TJTO (eproc1 + params) | `eproc1.tjto.jus.br/...?acao=processo_consulta_publica_login&acao_origem=processo_consulta_publica_tjto` | HTTP 200, tela "Login para a Consulta Pública" (Gov.Br) |
| TJRN (pje1g) | `pje1g.tjrn.jus.br/pje/ConsultaPublica/listView.seam` | HTTP 403 (WAF) – URL correta |
| TJPB | `pje.tjpb.jus.br/...` → redirect consultapublica.tjpb | HTTP 403 Cloudflare "Just a moment..." |
| TRF6 (1g) | `pje1g.trf6.jus.br/consultapublica/ConsultaPublica/listView.seam` | HTTP 200, formulário consulta pública carregado |
| TJPI (e-TJPI) | `www.tjpi.jus.br/e-tjpi/home/consulta` | HTTP 200, formulário por parte/documento |
| TJGO (Projudi) | `projudi.tjgo.jus.br/BuscaProcesso?PaginaInicial` | HTTP 200, formulário presente, com challenge Turnstile |
| TJSE (interface) | `interface-consultaprocessual.tjse.jus.br/consultaprocessual/` | HTTP 200, portal protegido por challenge/captcha |

## Como validar

- Script de captura: `npm run tribunal:capture -- --tribunal <id> --outdir artifacts/validation-captures`
- Conferir `metadata.json` (status HTTP, `navigationError`, `domSummary`) e screenshot.
