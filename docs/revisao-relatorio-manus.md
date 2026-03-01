# Revisão Técnica do Relatório Manus AI (2026-03-01)

## Objetivo
Validar tecnicamente os principais achados do relatório Manus e registrar quais pontos podem ser aplicados imediatamente no projeto.

## Resultado Executivo
- O relatório traz **bons direcionamentos**, especialmente em descoberta de URL ativa por tribunal.
- Pontos com evidência forte no nosso ambiente:
  - `TJAM`: URL antiga estava quebrada; URL nova `consultasaj` é coerente.
  - `TJRS`: bloqueio `403/anti-bot` permanece consistente.
  - `TJMT`: rota oficial redireciona para `consultaprocessual.tjmt.jus.br`.
- Pontos que exigem validação adicional em ambiente de produção (por variação de rede/WAF):
  - `TJRO`: rota alternativa existe, mas em automação apresentou comportamento instável/bloqueio.
  - `STF`: desafio anti-automação/captcha é plausível, porém não resolvido por crawler HTTP puro.

## Validação por item

## 1) TJAM
- **Alegação Manus:** trocar `https://esaj.tjam.jus.br/cpopg/open.do` por `https://consultasaj.tjam.jus.br/cpopg/open.do`.
- **Status:** `CONFIRMADO`.
- **Evidência:**
  - URL antiga: `404`.
  - URL nova: `200` com form e-SAJ (`cbPesquisa`, `DOCPARTE`).
- **Ação aplicada no projeto:** `SIM`.
  - `docs/tribunais-consulta-publica-92.tsv` atualizado para `consultasaj`.

## 2) TJRO
- **Alegação Manus:** rota pública alternativa `https://pjepg-consulta.tjro.jus.br/consulta/ConsultaPublica/listView.seam`.
- **Status:** `PARCIAL`.
- **Evidência:**
  - A rota alternativa responde em alguns acessos/cenários.
  - Em automação browser, ocorreu `ERR_INVALID_HTTP_RESPONSE` em tentativa de captura.
  - Em execução HTTP do crawler, variou entre `access_blocked` e `timeout_or_network`.
- **Ação aplicada no projeto:** `SIM`, com cautela.
  - `docs/tribunais-consulta-publica-92.tsv` aponta agora para a rota alternativa.
- **Pendência técnica:** validar com Playwright em ambiente de produção com IP estável.

## 3) TJRS
- **Alegação Manus:** bloqueio Cloudflare/anti-bot.
- **Status:** `CONFIRMADO`.
- **Evidência:**
  - Endpoint retorna `HTTP 403` de forma consistente no crawler.
- **Ação aplicada no projeto:** `NÃO (depende de infraestrutura)`.
- **Próximo passo:** estratégia de acesso (IP dedicado/whitelist ou conector browser com políticas anti-bot compatíveis).

## 4) TJMT
- **Alegação Manus:** redireciona para `https://consultaprocessual.tjmt.jus.br/` e exige fluxo mais dinâmico.
- **Status:** `CONFIRMADO`.
- **Evidência:**
  - URL PJe redireciona para `consultaprocessual.tjmt.jus.br`.
- **Ação aplicada no projeto:** `SIM`.
  - `docs/tribunais-consulta-publica-92.tsv` atualizado para a URL direta de consulta processual.
- **Pendência técnica:** implementar fluxo browser-first para interação de formulário dinâmico.

## 5) STF
- **Alegação Manus:** presença de challenge/captcha na consulta.
- **Status:** `INCONCLUSIVO NO HTTP PURO`.
- **Evidência:**
  - Endpoint responde `200`, mas crawler não obtém fluxo consultável estável.
- **Ação aplicada no projeto:** `NÃO` (sem mudança de rota).
- **Próximo passo:** conector `custom/stf` com inspeção browser-first e decisão formal sobre tratamento de captcha.

## Alterações já aplicadas no repositório
1. Atualizada URL do `TJAM` para `https://consultasaj.tjam.jus.br/cpopg/open.do`.
2. Atualizada URL do `TJRO` para `https://pjepg-consulta.tjro.jus.br/consulta/ConsultaPublica/listView.seam`.
3. Atualizada URL do `TJMT` para `https://consultaprocessual.tjmt.jus.br/`.

Arquivo alterado:
- `docs/tribunais-consulta-publica-92.tsv`

## Recomendação prática para o time
1. Tratar a atualização de URL como camada 1 (rápida).
2. Tratar browser-first para `no_automatable_form` como camada 2.
3. Tratar bloqueios (`403/access_blocked/captcha`) como camada 3 de infraestrutura e governança de acesso.
