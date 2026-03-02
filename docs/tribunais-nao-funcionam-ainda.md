# Tribunais NÃO Funcionais Ainda (Não Eleitorais)

## Escopo
Relatório técnico para handoff de desenvolvimento dos tribunais que **ainda não funcionam** no crawler judicial por entidade (CNPJ/nome), **excluindo eleitorais**.

## Snapshot utilizado
- Data: **2026-03-01**
- Execução de referência: `run_id=403eda3d-95de-4315-9af0-ad0f9db71e3d`
- Empresa de teste: **BYD DO BRASIL LTDA** (`17.140.820/0001-81`)
- Search ID: `33491624-f450-4fee-89e0-576579b45939`
- Deploy validado: `287a0495-81d3-4a2f-a598-2e99f327aee8` (Railway production)
- Observação: snapshot coletado com investigação ainda em execução (`consulted=88/89` no momento da captura), mas já consolidado para os tribunais listados abaixo.

## Atualização pós-ajustes (2026-03-01, validação local)
- Fontes atualizadas no catálogo (TSV) e no conector:
  - `trf6` -> `https://pje1g.trf6.jus.br/consultapublica/ConsultaPublica/listView.seam`
  - `tjpi` -> `https://www.tjpi.jus.br/e-tjpi/home/consulta`
  - `tjgo` -> `https://projudi.tjgo.jus.br/BuscaProcesso?PaginaInicial`
  - `tjse` -> `https://interface-consultaprocessual.tjse.jus.br/consultaprocessual/`
- Resultado com CNPJ BYD (`17.140.820/0001-81`) via `runJudicialConnectorQuery`:
  - `trf6`: **success/match_found** (17 processos)
  - `tjpi`: **not_found/not_listed** (antes estava em timeout/DNS)
  - `tjmt`: **not_found/not_listed** via browser-first (antes `no_automatable_form`)
  - `tjgo`: **unavailable/captcha_blocked** (antes `timeout_or_network`)
  - `tjse`: **unavailable/captcha_blocked** (antes `timeout_or_network`)
  - `tjrn`: **unavailable/access_blocked** (antes `timeout_or_network`)
  - `tjpa`: segue **unavailable/no_automatable_form** (portal dinâmico sem formulário acessível no DOM principal)
- Capturas Playwright novas em `artifacts/validation-captures` confirmam:
  - `trf6` e `tjpi` com formulário carregado (HTTP 200)
  - `tjgo` e `tjse` com desafio anti-bot/captcha

## Resumo (não eleitorais)
- Itens de cobertura considerados: **109**
- `success`: **12**
- `not_found`: **42**
- `unavailable`: **55**
- Tribunais únicos não funcionais: **29**

### Motivos de indisponibilidade (não eleitorais)
- `timeout_or_network`: 43
- `access_blocked`: 6
- `no_automatable_form`: 4
- `public_query_disabled`: 2

## Lista completa dos não funcionais (não eleitorais)
> Nota: a tabela abaixo é o snapshot original de referência. Para estado corrente pós-correções, use a seção **Atualização pós-ajustes (2026-03-01, validação local)**.

| tribunal_id | Tribunal | Família | Querys indisponíveis | Sintoma atual | Ação recomendada para dev |
|---|---|---|---|---|---|
| `stf` | Supremo Tribunal Federal | `custom` | cnpj_exact:timeout_or_network<br>party_name:timeout_or_network | Nenhum endpoint público respondeu de forma consultável | Rede/estabilidade: timeout por tribunal, retries com jitter, hosts alternativos e circuito de retentativa |
| `stj` | Superior Tribunal de Justiça | `custom` | cnpj_exact:access_blocked<br>party_name:access_blocked | Nenhum endpoint público respondeu de forma consultável | Bloqueio/WAF: exigir IP fixo + allowlist + UA corporativo + telemetria de bloqueio |
| `tjal` | Tribunal de Justiça de Alagoas | `esaj` | cnpj_exact:timeout_or_network<br>party_name:timeout_or_network | CPoPG: CPOPG indisponível (timeout_or_network); CPoSG: CPOSG indisponível (timeout_or_network) | Rede/estabilidade: timeout por tribunal, retries com jitter, hosts alternativos e circuito de retentativa |
| `tjap` | Tribunal de Justiça do Amapá | `pje` | cnpj_exact:timeout_or_network<br>party_name:timeout_or_network | Nenhum endpoint público respondeu de forma consultável | Rede/estabilidade: timeout por tribunal, retries com jitter, hosts alternativos e circuito de retentativa |
| `tjes` | Tribunal de Justiça do Espírito Santo | `pje` | cnpj_exact:timeout_or_network<br>party_name:timeout_or_network | Nenhum endpoint público respondeu de forma consultável | Rede/estabilidade: timeout por tribunal, retries com jitter, hosts alternativos e circuito de retentativa |
| `tjgo` | Tribunal de Justiça de Goiás | `pje` | cnpj_exact:timeout_or_network<br>party_name:timeout_or_network | Nenhum endpoint público respondeu de forma consultável | Rede/estabilidade: timeout por tribunal, retries com jitter, hosts alternativos e circuito de retentativa |
| `tjms` | Tribunal de Justiça do Mato Grosso do Sul | `eproc` | cnpj_exact:timeout_or_network<br>party_name:timeout_or_network | Nenhum endpoint público respondeu de forma consultável | Rede/estabilidade: timeout por tribunal, retries com jitter, hosts alternativos e circuito de retentativa |
| `tjmt` | Tribunal de Justiça do Mato Grosso | `pje` | cnpj_exact:no_automatable_form<br>party_name:no_automatable_form | Página pública alcançada, porém sem formulário de busca automatizável; browser-first: Fallback browser não encontrou campo editável para a consulta | Browser-profile: mapear seletores reais por tribunal (Playwright capture) e conector dedicado |
| `tjpa` | Tribunal de Justiça do Pará | `pje` | cnpj_exact:no_automatable_form<br>party_name:no_automatable_form | Página pública alcançada, porém sem formulário de busca automatizável; browser-first: Fallback browser falhou: page.goto: Page crashed | Browser-profile: mapear seletores reais por tribunal (Playwright capture) e conector dedicado |
| `tjpb` | Tribunal de Justiça da Paraíba | `pje` | cnpj_exact:timeout_or_network<br>party_name:timeout_or_network | Nenhum endpoint público respondeu de forma consultável | Rede/estabilidade: timeout por tribunal, retries com jitter, hosts alternativos e circuito de retentativa |
| `tjpi` | Tribunal de Justiça do Piauí | `pje` | cnpj_exact:timeout_or_network<br>party_name:timeout_or_network | Nenhum endpoint público respondeu de forma consultável; browser-first: Fallback browser falhou: page.goto: net::ERR_NAME_NOT_RESOLVED at https://tjpi.pje.jus.br/pje/ConsultaPublica/listView.seam | Rede/estabilidade: timeout por tribunal, retries com jitter, hosts alternativos e circuito de retentativa |
| `tjrn` | Tribunal de Justiça do Rio Grande do Norte | `pje` | cnpj_exact:timeout_or_network | Nenhum endpoint público respondeu de forma consultável | Rede/estabilidade: timeout por tribunal, retries com jitter, hosts alternativos e circuito de retentativa |
| `tjro` | Tribunal de Justiça de Rondônia | `pje` | cnpj_exact:access_blocked<br>party_name:access_blocked | Portal bloqueou o acesso da automação para consulta pública | Bloqueio/WAF: exigir IP fixo + allowlist + UA corporativo + telemetria de bloqueio |
| `tjrr` | Tribunal de Justiça de Roraima | `pje` | cnpj_exact:timeout_or_network<br>party_name:timeout_or_network | Nenhum endpoint público respondeu de forma consultável | Rede/estabilidade: timeout por tribunal, retries com jitter, hosts alternativos e circuito de retentativa |
| `tjrs` | Tribunal de Justiça do Rio Grande do Sul | `eproc` | cnpj_exact:access_blocked<br>party_name:access_blocked | Nenhum endpoint público respondeu de forma consultável | Bloqueio/WAF: exigir IP fixo + allowlist + UA corporativo + telemetria de bloqueio |
| `tjse` | Tribunal de Justiça de Sergipe | `pje` | cnpj_exact:timeout_or_network<br>party_name:timeout_or_network | Nenhum endpoint público respondeu de forma consultável | Rede/estabilidade: timeout por tribunal, retries com jitter, hosts alternativos e circuito de retentativa |
| `tjto` | Tribunal de Justiça do Tocantins | `eproc` | cnpj_exact:timeout_or_network<br>party_name:timeout_or_network | Nenhum endpoint público respondeu de forma consultável | Rede/estabilidade: timeout por tribunal, retries com jitter, hosts alternativos e circuito de retentativa |
| `trf4` | TRF 4ª Região | `eproc` | cnpj_exact:public_query_disabled<br>party_name:public_query_disabled | Portal informa que a consulta pública está desativada | Sem correção via crawler (consulta pública desativada oficialmente) |
| `trf6` | TRF 6ª Região | `pje` | cnpj_exact:timeout_or_network<br>party_name:timeout_or_network | Nenhum endpoint público respondeu de forma consultável | Rede/estabilidade: timeout por tribunal, retries com jitter, hosts alternativos e circuito de retentativa |
| `trt1` | TRT 1ª Região | `pje` | cnpj_exact:timeout_or_network<br>party_name:timeout_or_network | Nenhum endpoint público respondeu de forma consultável | Rede/estabilidade: timeout por tribunal, retries com jitter, hosts alternativos e circuito de retentativa |
| `trt10` | TRT 10ª Região | `pje` | cnpj_exact:timeout_or_network | Nenhum endpoint público respondeu de forma consultável | Rede/estabilidade: timeout por tribunal, retries com jitter, hosts alternativos e circuito de retentativa |
| `trt12` | TRT 12ª Região | `pje` | cnpj_exact:timeout_or_network<br>party_name:timeout_or_network | Nenhum endpoint público respondeu de forma consultável | Rede/estabilidade: timeout por tribunal, retries com jitter, hosts alternativos e circuito de retentativa |
| `trt16` | TRT 16ª Região | `pje` | cnpj_exact:timeout_or_network | Nenhum endpoint público respondeu de forma consultável | Rede/estabilidade: timeout por tribunal, retries com jitter, hosts alternativos e circuito de retentativa |
| `trt17` | TRT 17ª Região | `pje` | cnpj_exact:timeout_or_network<br>party_name:timeout_or_network | Nenhum endpoint público respondeu de forma consultável | Rede/estabilidade: timeout por tribunal, retries com jitter, hosts alternativos e circuito de retentativa |
| `trt20` | TRT 20ª Região | `pje` | cnpj_exact:timeout_or_network<br>party_name:timeout_or_network | Nenhum endpoint público respondeu de forma consultável | Rede/estabilidade: timeout por tribunal, retries com jitter, hosts alternativos e circuito de retentativa |
| `trt23` | TRT 23ª Região | `pje` | cnpj_exact:timeout_or_network<br>party_name:timeout_or_network | Nenhum endpoint público respondeu de forma consultável | Rede/estabilidade: timeout por tribunal, retries com jitter, hosts alternativos e circuito de retentativa |
| `trt5` | TRT 5ª Região | `pje` | cnpj_exact:timeout_or_network<br>party_name:timeout_or_network | Nenhum endpoint público respondeu de forma consultável | Rede/estabilidade: timeout por tribunal, retries com jitter, hosts alternativos e circuito de retentativa |
| `trt6` | TRT 6ª Região | `pje` | cnpj_exact:timeout_or_network<br>party_name:timeout_or_network | Nenhum endpoint público respondeu de forma consultável | Rede/estabilidade: timeout por tribunal, retries com jitter, hosts alternativos e circuito de retentativa |
| `trt8` | TRT 8ª Região | `pje` | cnpj_exact:timeout_or_network<br>party_name:timeout_or_network | Nenhum endpoint público respondeu de forma consultável | Rede/estabilidade: timeout por tribunal, retries com jitter, hosts alternativos e circuito de retentativa |

## Ajustes feitos (pós-screenshot 2026-03-01)
- **tjap**: URL alterada para **1g** (não primeirograu): `pje.tjap.jus.br/1g/ConsultaPublica/listView.seam`. Teste local 2026-03-01: HTTP 200, formulário de consulta.
- **tjrn**: URL alterada para host **pje1g** e path **pje**: `pje1g.tjrn.jus.br/pje/ConsultaPublica/listView.seam`. Teste local: 403 (WAF); URL correta, bloqueio por origem.
- **tjal**: URL alterada de `esaj.tjal.jus.br` para **www2.tjal.jus.br**/cpopg/open.do (ERR_NAME_NOT_RESOLVED no esaj). Teste local: HTTP 200, e-SAJ 1º grau.
- **tjto**: Host **eproc1** e params `acao=processo_consulta_publica_login&acao_origem=processo_consulta_publica_tjto`. Teste: 200, tela exige login Gov.Br para consultar.
- **tjms**: Passou a usar **e-SAJ** (não eproc): `esaj.tjms.jus.br/cpopg5/open.do`; connector esaj com suporte a cpopg5. Teste: 200, formulário 1º grau.
- **tjpi**: Path alterado para **1g**. Host tjpi.pje.jus.br pode não resolver em alguns ambientes (DNS).
- **tjes**: URL alterada de `sistemas.tjes.jus.br` para `pje.tjes.jus.br` (405/human verification no sistemas). Em teste local, pje.tjes retorna 300 e redireciona para “consulta na base nacional do CNJ”; evita bloqueio Cloudflare.
- **tjmt**: URL unificada para `consultaprocessual.tjmt.jus.br`; host prioritário no PJE; seletores de browser ampliados (placeholder Parte/Buscar) para a tela de consulta única.
- **PJE_HOST_ALIASES**: tjmt passa a tentar `consultaprocessual.tjmt.jus.br` primeiro; tjes passa a tentar `pje.tjes.jus.br` antes de sistemas.

## Observações críticas para o dev
1. O problema de runtime do Playwright foi parcialmente resolvido.
- Saiu do erro `Executable doesn't exist`.
- Agora os erros remanescentes são de fluxo real: `no_automatable_form`, `page crashed`, `ERR_NAME_NOT_RESOLVED`, `access_blocked`.

2. Casos PJe dinâmicos que exigem conector browser dedicado imediato:
- `tjmt`: ajustado (consultaprocessual + seletores). Se ainda falhar, validar no ambiente.
- `tjpa`: browser abre, porém `page.goto` crasha (possível instabilidade do portal).
- `tjpi`: migrado para e-TJPI; avaliar extração de detalhes/resultados para reduzir falsos `not_found`.

3. Casos bloqueados por portal (WAF/anti-bot) que não fecham só com código:
- `stj`, `tjro`, `tjrs`.

4. Caso oficialmente indisponível:
- `trf4` com `public_query_disabled`.

## Backlog objetivo (prioridade)
1. **P0 Browser profiles por tribunal (PJe dinâmico)**
- Criar perfil dedicado para `tjmt` e `tjpa` via Playwright capture (`selector map`, `submit`, waits, fallback de iframe/shadow).
- Para `tjpi`, consolidar parser do fluxo e-TJPI (campos `nome_parte`/`doc_parte`) e paginação.

2. **P0 Infra para bloqueio de portal**
- IP fixo/egress dedicado.
- Cabeçalhos estáveis + rotação controlada de UA.
- Telemetria de bloqueio (HTTP 403, challenge pages, fingerprint).

3. **P1 Resiliência de rede por tribunal**
- Timeout e retries por perfil (já iniciado), com ajuste fino nos tribunais de maior falha.
- Circuit breaker por host para evitar avalanche e degradação global.

4. **P1 Catálogo/URL ativo por tribunal**
- Conferência contínua de host/rota pública por família (PJe/eproc/esaj/custom).

5. **P2 Telemetria persistente para diagnóstico fino**
- Salvar `final_url`, `status_http`, `first_byte_ms`, erro de parser e hash da resposta por tribunal/query.

## Como reproduzir rápido
1. Disparar análise:
```bash
curl -sS -X POST "https://data-sweep-engine-web-production.up.railway.app/api/analyze-cnpj" \
  -H "content-type: application/json" \
  -d '{"cnpj":"17140820000181"}'
```
2. Ler cobertura judicial do `run_id` retornado:
```bash
curl -sS "https://data-sweep-engine-web-production.up.railway.app/api/investigations/<RUN_ID>/judicial/coverage"
```
