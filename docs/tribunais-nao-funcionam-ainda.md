# Tribunais NÃO Funcionais Ainda (Não Eleitorais)

## Escopo
Relatório técnico para handoff de desenvolvimento dos tribunais que **ainda não funcionam** no crawler judicial por entidade (CNPJ), **excluindo tribunais eleitorais**.

## Snapshot de referência
- Data/hora início (UTC): `2026-03-01T17:18:27.487Z`
- Data/hora fim (UTC): `2026-03-01T17:22:21.859Z`
- Query de teste: `cnpj_exact`
- Documento usado no teste: `17140820000181` (BYD do Brasil Ltda)
- Timeout por tribunal: `10000ms`
- Total de tribunais não eleitorais testados: `61`
- Resultado agregado:
  - `success`: 9
  - `not_found`: 30
  - `unavailable`: 22

## Resumo dos que NÃO funcionam
Total: **22 tribunais**

Quebra por motivo técnico (`statusReason`):
- `timeout_or_network`: 14
- `no_automatable_form`: 4
- `http_404`: 1
- `access_blocked`: 1
- `http_403`: 1
- `public_query_disabled`: 1

## Lista completa dos não funcionais
| tribunal_id | Tribunal | Família | URL base usada | statusReason | Sintoma observado | Hipótese técnica principal | Ação recomendada para dev |
|---|---|---|---|---|---|---|---|
| `stf` | Supremo Tribunal Federal | `custom` | `https://portal.stf.jus.br/processos/consultaProcessual.asp` | `timeout_or_network` | Nenhum endpoint público respondeu de forma consultável | Portal sem resposta útil no timeout atual/fluxo não compatível com parser atual | Implementar conector `custom/stf` com fluxo específico da página de consulta do STF + retries e timeout maior |
| `tjal` | Tribunal de Justiça de Alagoas | `esaj` | `https://esaj.tjal.jus.br/cpopg/open.do` | `timeout_or_network` | Nenhum endpoint público respondeu de forma consultável | Timeout/rede ou intermitência no host ESAJ | Aumentar timeout/retries no ESAJ deste tribunal + validação com Playwright headed |
| `tjam` | Tribunal de Justiça do Amazonas | `esaj` | `https://esaj.tjam.jus.br/cpopg/open.do` | `http_404` | Nenhum endpoint público respondeu de forma consultável | URL de consulta pública provavelmente alterada | Redescobrir URL ativa (open/search) e atualizar `base_url` no catálogo |
| `tjdft` | Tribunal de Justiça do Distrito Federal e Territórios | `pje` | `https://pje.tjdft.jus.br/pje/ConsultaPublica/listView.seam` | `timeout_or_network` | Nenhum endpoint público respondeu de forma consultável | Endpoint oficial inacessível no timeout atual/rota alternativa | Validar hosts alternativos PJe TJDFT e ajustar lista de candidatos |
| `tjes` | Tribunal de Justiça do Espírito Santo | `pje` | `https://sistemas.tjes.jus.br/pje/ConsultaPublica/listView.seam` | `timeout_or_network` | Nenhum endpoint público respondeu de forma consultável | Instabilidade de rede/portal; possível rota alternativa | Captura Playwright + HAR para descobrir endpoint que responde no ambiente de execução |
| `tjgo` | Tribunal de Justiça de Goiás | `pje` | `https://pje.tjgo.jus.br/pje/ConsultaPublica/listView.seam` | `timeout_or_network` | Nenhum endpoint público respondeu de forma consultável | Timeout/intermitência do PJe | Ajustar política de tentativas e timeout; validar bloqueio de IP no ambiente de produção |
| `tjms` | Tribunal de Justiça do Mato Grosso do Sul | `eproc` | `https://eproc.tjms.jus.br/eprocV2/externo_controlador.php?acao=processo_consulta_publica` | `timeout_or_network` | Nenhum endpoint público respondeu de forma consultável | Endpoint eproc indisponível no momento/rota protegida | Criar fallback de rota eproc + Playwright para coleta dos campos ativos |
| `tjmt` | Tribunal de Justiça do Mato Grosso | `pje` | `https://pje.tjmt.jus.br/pje/ConsultaPublica/listView.seam` | `no_automatable_form` | Página pública alcançada, porém sem formulário de busca automatizável | Página depende de renderização JS/iframe/fluxo que parser HTML não resolve | Criar conector browser-first (Playwright) para preencher/submeter o form |
| `tjpa` | Tribunal de Justiça do Pará | `pje` | `https://pje.tjpa.jus.br/pje/ConsultaPublica/listView.seam` | `no_automatable_form` | Página pública alcançada, porém sem formulário de busca automatizável | Mesmo padrão de tela sem form parseável estático | Implementar fluxo Playwright específico para este PJe |
| `tjpb` | Tribunal de Justiça da Paraíba | `pje` | `https://pje.tjpb.jus.br/pje/ConsultaPublica/listView.seam` | `timeout_or_network` | Nenhum endpoint público respondeu de forma consultável | Timeout/rede ou porta/host alternativo | Verificar host alternativo de consulta pública e aumentar timeout de primeira carga |
| `tjpe` | Tribunal de Justiça de Pernambuco | `pje` | `https://pje.tjpe.jus.br/1g/ConsultaPublica/listView.seam` | `no_automatable_form` | Página pública alcançada, porém sem formulário de busca automatizável | Estrutura dinâmica de tela não atendida pelo parser atual | Conector Playwright com seleção de campos por label/placeholder |
| `tjpi` | Tribunal de Justiça do Piauí | `pje` | `https://tjpi.pje.jus.br/pje/ConsultaPublica/listView.seam` | `no_automatable_form` | Página pública alcançada, porém sem formulário de busca automatizável | Tela dinâmica/DOM pós-JS | Implementar captura JS render + submit via browser |
| `tjrn` | Tribunal de Justiça do Rio Grande do Norte | `pje` | `https://pje.tjrn.jus.br/pje1grau/ConsultaPublica/listView.seam` | `timeout_or_network` | Nenhum endpoint público respondeu de forma consultável | Timeout/rede/intermitência | Testar rotas variantes (`/pje/`, `/primeirograu/`) e reforçar retries |
| `tjro` | Tribunal de Justiça de Rondônia | `pje` | `https://pje.tjro.jus.br/pg/ConsultaPublica/listView.seam` | `access_blocked` | Portal bloqueou o acesso da automação para consulta pública | WAF/anti-bot/controle por IP ou User-Agent | Necessário bypass legítimo: whitelisting de IP, user-agent corporativo, ou sessão autenticada permitida |
| `tjrr` | Tribunal de Justiça de Roraima | `pje` | `https://pje.tjrr.jus.br/pje/ConsultaPublica/listView.seam` | `timeout_or_network` | Nenhum endpoint público respondeu de forma consultável | Timeout/rede | Revalidar disponibilidade com browser real e ajustar timeout/retries |
| `tjrs` | Tribunal de Justiça do Rio Grande do Sul | `eproc` | `https://eproc1g.tjrs.jus.br/eproc/externo_controlador.php?acao=processo_consulta_publica` | `http_403` | Nenhum endpoint público respondeu de forma consultável | Bloqueio explícito HTTP 403 | Tratar como bloqueio de origem; avaliar IP dedicado/proxy corporativo e negociação de acesso |
| `tjse` | Tribunal de Justiça de Sergipe | `pje` | `https://pje.tjse.jus.br/pje/ConsultaPublica/listView.seam` | `timeout_or_network` | Nenhum endpoint público respondeu de forma consultável | Instabilidade/rede | Aumentar timeout e testar host alternativo da consulta pública |
| `tjto` | Tribunal de Justiça do Tocantins | `eproc` | `https://eproc1g.tjto.jus.br/eprocV2_prod_1grau/externo_controlador.php?acao=processo_consulta_publica` | `timeout_or_network` | Nenhum endpoint público respondeu de forma consultável | Endpoint eproc sem resposta útil no timeout | Captura Playwright para confirmar necessidade de sessão/challenge antes da busca |
| `trf3` | TRF 3ª Região | `pje` | `https://web.trf3.jus.br/consultas/Internet/ConsultaProcessual` | `timeout_or_network` | Nenhum endpoint público respondeu de forma consultável | URL pode não ser endpoint direto de submit para entidade | Criar perfil `custom/trf3` com rota/form exatos por nome/CNPJ |
| `trf4` | TRF 4ª Região | `eproc` | `https://eproc.trf4.jus.br/eproc2trf4/externo_controlador.php?acao=processo_consulta_publica` | `public_query_disabled` | Portal informa que a consulta pública está desativada | Restrição oficial do próprio portal | Não há correção de crawler; manter status indisponível e orientar usuário para canais alternativos |
| `trf6` | TRF 6ª Região | `pje` | `https://pje.trf6.jus.br/pje/ConsultaPublica/listView.seam` | `timeout_or_network` | Nenhum endpoint público respondeu de forma consultável | Timeout/rede/instabilidade | Aumentar timeout e validar candidatos alternativos de host/caminho |
| `trt17` | TRT 17ª Região | `pje` | `https://pje.trtes.jus.br/primeirograu/ConsultaPublica/listView.seam` | `timeout_or_network` | Nenhum endpoint público respondeu de forma consultável | Endpoint intermitente ou bloqueio de origem | Implementar fallback de hosts TRT17 + telemetria de disponibilidade |

## Priorização sugerida (para atacar rápido)
1. **Correções de URL e rota (ganho rápido)**
- `tjam` (`http_404`): atualizar URL ativa.
- `trf3` (`timeout_or_network` em endpoint não padrão): criar conector custom com rota correta.

2. **Bloqueios explícitos (depende de infraestrutura/acesso)**
- `tjro` (`access_blocked`)
- `tjrs` (`http_403`)
- Ações: IP fixo, cabeçalhos corporativos, eventual acordo de acesso, observabilidade de bloqueio.

3. **Páginas dinâmicas sem form parseável (browser-first)**
- `tjmt`, `tjpa`, `tjpe`, `tjpi` (`no_automatable_form`)
- Ação: conector Playwright com seleção por label e submit real.

4. **Timeout/rede (maior volume de falhas)**
- `stf`, `tjal`, `tjdft`, `tjes`, `tjgo`, `tjms`, `tjpb`, `tjrn`, `tjrr`, `tjse`, `tjto`, `trf6`, `trt17`
- Ação: timeout maior por família, retries com jitter, tentativa de URL alternativa e métrica de disponibilidade por tribunal.

5. **Sem solução técnica por crawler (restrição oficial)**
- `trf4` (`public_query_disabled`)

## Backlog técnico objetivo para o dev
1. Criar `connector_profile` por tribunal problemático (JSON) com:
- URL inicial real
- Método/form action
- Campos `cnpj_exact` e `party_name`
- Necessidade de sessão/token/viewstate
- Estratégia de paginação

2. Adicionar motor browser (`playwright`) somente para tribunais com `no_automatable_form`.

3. Aumentar robustez de rede por família:
- `timeoutMs` por tribunal
- retries exponenciais com jitter
- circuit-breaker curto para evitar avalanche

4. Instrumentar telemetria persistente por tribunal:
- `first_byte_ms`, `dns/connect/tls` (quando possível)
- status HTTP
- motivo final
- hash da URL final

5. Classificar indisponibilidade com semântica de produto:
- `blocked_by_portal`
- `portal_unavailable`
- `portal_disabled`
- `needs_browser_flow`

## Como reproduzir localmente
1. Rodar snapshot completo:
```bash
node --input-type=module <<'NODE'
import fs from 'node:fs';
import { getDefaultTribunalCatalog } from './server/judicial-catalog.mjs';
import { runGenericTribunalConnector } from './server/judicial-generic-connectors.mjs';

const catalog = getDefaultTribunalCatalog().filter(t => t.ramo !== 'eleitoral' && t.tribunal_id !== 'tse');
for (const tribunal of catalog) {
  if (tribunal.connector_family === 'datajud') continue;
  const out = await runGenericTribunalConnector({
    connectorFamily: tribunal.connector_family,
    tribunal,
    queryMode: 'cnpj_exact',
    document: '17140820000181',
    timeoutMs: 10000,
  });
  console.log(tribunal.tribunal_id, out.status, out.statusReason);
}
NODE
```

2. Snapshot bruto usado neste relatório:
- `tmp/tribunal-non-working-snapshot.json`

## Observação importante
Este relatório é um retrato **pontual** de disponibilidade de portais públicos (alto grau de instabilidade). Parte dos `timeout_or_network` pode variar por horário, origem de IP e políticas anti-bot dos tribunais.
