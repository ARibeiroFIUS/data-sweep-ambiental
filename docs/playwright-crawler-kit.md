# Playwright Crawler Kit (Tribunais)

Este kit acelera a descoberta de telas e seletores de consulta publica por tribunal.

## O que ja esta pronto

- Base de links de consulta: `docs/tribunais-consulta-publica-92.tsv`
- Listagem/filtragem de tribunais: `npm run tribunal:list`
- Codegen guiado por tribunal: `npm run tribunal:codegen`
- Captura automatica de evidencia (HTML + screenshot + HAR): `npm run tribunal:capture`

## Instalar browsers do Playwright

```bash
npm i -D @playwright/test
npm run pw:install
```

## 0) Smoke tests base (4 tribunais)

```bash
npm run pw:test:tribunais
```

Escopo inicial configurado:

- `tjba`
- `tjsp`
- `trf1`
- `trt2`

Arquivos:

- `playwright.config.ts`
- `playwright/tests/tribunais-base.spec.ts`
- `playwright/tests/helpers/tribunal-smoke.ts`

Saida:

- relatorio Playwright em `playwright-report/`
- traces/videos/screenshots de falha em `test-results/`

## 1) Listar tribunais

```bash
npm run tribunal:list
npm run tribunal:list -- --family pje
npm run tribunal:list -- --ramo eleitoral
npm run tribunal:list -- --contains tjba
```

## 2) Rodar codegen para um tribunal

```bash
npm run tribunal:codegen -- --tribunal tjba
```

Opcional:

```bash
npm run tribunal:codegen -- --tribunal trf1 --output artifacts/codegen/trf1.spec.ts
npm run tribunal:codegen -- --tribunal tjsp --browser chromium --target playwright-test
```

Notas:

- O browser abre em modo interativo.
- Se aparecer captcha/login/SSO, a etapa manual e esperada.
- O arquivo de teste e salvo em `artifacts/codegen/<tribunal>.spec.ts` por padrao.

## 3) Capturar evidencia automatica de uma tela

```bash
npm run tribunal:capture -- --tribunal tjba
```

Opcional:

```bash
npm run tribunal:capture -- --tribunal trf1 --timeout 45000 --wait 4000
npm run tribunal:capture -- --url https://consultaunificadapje.tse.jus.br/ --name tse-unificado
npm run tribunal:capture -- --tribunal tjrs --headed
```

Saida gerada em `artifacts/captures/<tribunal>/<timestamp>/`:

- `page.png`
- `page.html`
- `network.har`
- `requests.json`
- `metadata.json`

## Quando voce precisa atuar manualmente

- captcha anti-bot
- login/SSO corporativo
- MFA
- bloqueio por IP/geo

Fora isso, o fluxo pode ser totalmente automatizado pelo time tecnico.
