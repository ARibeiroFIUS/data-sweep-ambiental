import { cleanDocument, normalizePersonName } from "./common-utils.mjs";

const DEFAULT_BROWSER_TRIBUNALS = ["tjmt", "tjpa", "tjpe", "tjpi"];
const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

const PROCESS_NUMBER_REGEX = /\b\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}\b/g;

function getBrowserTribunalSet() {
  const raw = String(process.env.JUDICIAL_BROWSER_TRIBUNALS ?? "").trim();
  if (!raw) return new Set(DEFAULT_BROWSER_TRIBUNALS);
  const values = raw
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  if (values.length === 0) return new Set(DEFAULT_BROWSER_TRIBUNALS);
  return new Set(values);
}

export function shouldUseBrowserFallbackForTribunal(tribunalId) {
  const key = String(tribunalId ?? "").trim().toLowerCase();
  if (!key) return false;
  return getBrowserTribunalSet().has(key);
}

function hasCaptcha(textOrHtml) {
  const lower = String(textOrHtml ?? "").toLowerCase();
  return (
    lower.includes("captcha") ||
    lower.includes("g-recaptcha") ||
    lower.includes("h-captcha") ||
    lower.includes("sou humano") ||
    lower.includes("não sou robô") ||
    lower.includes("nao sou robo")
  );
}

function hasAccessBlock(textOrHtml) {
  const lower = String(textOrHtml ?? "").toLowerCase();
  return (
    lower.includes("attention required") ||
    lower.includes("cloudflare") ||
    lower.includes("acesso negado") ||
    lower.includes("access denied") ||
    lower.includes("forbidden") ||
    lower.includes("request blocked")
  );
}

function hasLoginRequirement(textOrHtml) {
  const lower = String(textOrHtml ?? "").toLowerCase();
  return (
    (lower.includes("login") || lower.includes("entrar") || lower.includes("autentica")) &&
    (lower.includes("pje") || lower.includes("openid") || lower.includes("sso"))
  );
}

function hasNoResultsMarker(textOrHtml) {
  return /nenhum resultado|nenhum processo|não foram encontrados|nao foram encontrados|nenhum registro encontrado|sem registros/i.test(
    String(textOrHtml ?? ""),
  );
}

function normalizeQueryValue({ queryMode, document, name }) {
  if (queryMode === "cnpj_exact") {
    const cnpj = cleanDocument(document);
    if (cnpj.length !== 14) {
      return {
        ok: false,
        status: "invalid",
        statusReason: "invalid_cnpj",
        message: "CNPJ inválido para consulta judicial em browser",
        value: "",
      };
    }
    return { ok: true, value: cnpj };
  }

  if (queryMode === "party_name") {
    const fullName = String(name ?? "").trim();
    const tokenCount = normalizePersonName(fullName)
      .split(" ")
      .filter(Boolean).length;
    if (tokenCount < 2) {
      return {
        ok: false,
        status: "invalid",
        statusReason: "invalid_party_name",
        message: "Nome insuficiente para consulta judicial em browser",
        value: "",
      };
    }
    return { ok: true, value: fullName };
  }

  return {
    ok: false,
    status: "unavailable",
    statusReason: "unsupported_query_mode",
    message: `Modo ${queryMode} não suportado em fallback browser`,
    value: "",
  };
}

function parseProcessesFromText(text, tribunalId, sourceUrl) {
  const found = String(text ?? "").match(PROCESS_NUMBER_REGEX) ?? [];
  const unique = Array.from(new Set(found)).slice(0, 120);
  return unique.map((numeroProcesso) => ({
    tribunal: tribunalId,
    numeroProcesso,
    classe: null,
    assuntos: [],
    dataAjuizamento: null,
    ano: null,
    orgaoJulgador: null,
    valor: null,
    grau: null,
    polo: null,
    parteContraria: [],
    andamentos: [],
    sourceUrl,
  }));
}

async function fillFirstInteractive(page, selectors, value) {
  for (const selector of selectors) {
    const locator = page.locator(selector);
    const count = await locator.count().catch(() => 0);
    if (!count) continue;
    const limit = Math.min(4, count);
    for (let index = 0; index < limit; index += 1) {
      const candidate = locator.nth(index);
      const visible = await candidate.isVisible().catch(() => false);
      const enabled = await candidate.isEnabled().catch(() => false);
      if (!visible || !enabled) continue;
      const type = String((await candidate.getAttribute("type").catch(() => "")) ?? "").toLowerCase();
      if (["hidden", "submit", "button", "radio", "checkbox", "file", "image"].includes(type)) continue;
      await candidate.fill("").catch(() => {});
      await candidate.fill(value).catch(() => {});
      const current = await candidate.inputValue().catch(() => "");
      if (String(current ?? "").trim()) return true;
    }
  }
  return false;
}

async function trySelectOptionByText(page, optionPattern) {
  return page
    .evaluate((patternSource) => {
      const regex = new RegExp(patternSource, "i");
      for (const select of Array.from(document.querySelectorAll("select"))) {
        for (const option of Array.from(select.options ?? [])) {
          const text = String(option.textContent ?? "").trim();
          if (!regex.test(text)) continue;
          select.value = option.value;
          select.dispatchEvent(new Event("input", { bubbles: true }));
          select.dispatchEvent(new Event("change", { bubbles: true }));
          return true;
        }
      }
      return false;
    }, optionPattern.source)
    .catch(() => false);
}

async function clickFirstVisible(page, selectors) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    const count = await locator.count().catch(() => 0);
    if (!count) continue;
    const visible = await locator.isVisible().catch(() => false);
    const enabled = await locator.isEnabled().catch(() => false);
    if (!visible || !enabled) continue;
    await locator.click({ timeout: 5000 }).catch(() => {});
    return true;
  }
  return false;
}

async function chooseDocumentSearchMode(page) {
  await trySelectOptionByText(page, /(documento|cpf\/?cnpj|cpf|cnpj)/i);
  await clickFirstVisible(page, [
    "label:has-text('CPF/CNPJ')",
    "label:has-text('CPF')",
    "label:has-text('CNPJ')",
    "label:has-text('Documento')",
    "input[type='radio'][value*='DOC' i]",
  ]);
}

async function chooseNameSearchMode(page) {
  await trySelectOptionByText(page, /(nome da parte|nome|parte)/i);
  await clickFirstVisible(page, [
    "label:has-text('Nome da Parte')",
    "label:has-text('Nome')",
  ]);
}

export async function runBrowserTribunalConnector({
  connectorFamily,
  tribunal,
  queryMode,
  document,
  name,
  timeoutMs,
}) {
  const startedAt = Date.now();
  const tribunalId = String(tribunal?.tribunal_id ?? "").toLowerCase();
  const baseUrl = String(tribunal?.config_json?.base_url ?? "").trim();
  if (!baseUrl) {
    return {
      connectorFamily,
      queryMode,
      status: "unavailable",
      statusReason: "invalid_tribunal",
      latencyMs: Date.now() - startedAt,
      message: "URL base não configurada para fallback browser",
      evidence: [],
      processes: [],
    };
  }

  const normalized = normalizeQueryValue({ queryMode, document, name });
  if (!normalized.ok) {
    return {
      connectorFamily,
      queryMode,
      status: normalized.status,
      statusReason: normalized.statusReason,
      latencyMs: Date.now() - startedAt,
      message: normalized.message,
      evidence: [],
      processes: [],
    };
  }

  let chromium = null;
  try {
    const playwrightModule = await import("@playwright/test");
    chromium = playwrightModule.chromium;
  } catch {
    return {
      connectorFamily,
      queryMode,
      status: "unavailable",
      statusReason: "browser_runtime_unavailable",
      latencyMs: Date.now() - startedAt,
      message: "Playwright indisponível no runtime para fallback browser",
      evidence: [],
      processes: [],
    };
  }

  const navTimeoutMs = Math.max(timeoutMs * 2, Number.parseInt(process.env.JUDICIAL_BROWSER_TIMEOUT_MS ?? "45000", 10));
  const headless = process.env.JUDICIAL_BROWSER_HEADLESS !== "false";
  const launchOptions = {
    headless,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  };
  if (process.env.PLAYWRIGHT_EXECUTABLE_PATH) {
    launchOptions.executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH;
  }

  let browser = null;
  let context = null;
  let page = null;
  try {
    browser = await chromium.launch(launchOptions);
    context = await browser.newContext({
      ignoreHTTPSErrors: true,
      userAgent: DEFAULT_USER_AGENT,
      viewport: { width: 1366, height: 1800 },
    });
    page = await context.newPage();
    page.setDefaultTimeout(Math.min(navTimeoutMs, 60000));

    await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: navTimeoutMs });
    await page.waitForTimeout(1200);

    const beforeHtml = await page.content().catch(() => "");
    const beforeText = await page.locator("body").innerText().catch(() => "");

    if (hasAccessBlock(`${beforeText}\n${beforeHtml}`)) {
      return {
        connectorFamily,
        queryMode,
        status: "unavailable",
        statusReason: "access_blocked",
        latencyMs: Date.now() - startedAt,
        message: "Portal bloqueou o acesso no fallback browser",
        evidence: [],
        processes: [],
      };
    }
    if (hasLoginRequirement(`${beforeText}\n${beforeHtml}`)) {
      return {
        connectorFamily,
        queryMode,
        status: "unavailable",
        statusReason: "login_required",
        latencyMs: Date.now() - startedAt,
        message: "Portal exige autenticação no fallback browser",
        evidence: [],
        processes: [],
      };
    }
    if (hasCaptcha(`${beforeText}\n${beforeHtml}`)) {
      return {
        connectorFamily,
        queryMode,
        status: "unavailable",
        statusReason: "captcha_blocked",
        latencyMs: Date.now() - startedAt,
        message: "Portal apresentou captcha no fallback browser",
        evidence: [],
        processes: [],
      };
    }

    if (queryMode === "cnpj_exact") {
      await chooseDocumentSearchMode(page);
    } else if (queryMode === "party_name") {
      await chooseNameSearchMode(page);
    }

    const value = normalized.value;
    const filled = queryMode === "cnpj_exact"
      ? await fillFirstInteractive(
          page,
          [
            "input[name*='cnpj' i]",
            "input[id*='cnpj' i]",
            "input[name*='cpfcnpj' i]",
            "input[id*='cpfcnpj' i]",
            "input[name*='documento' i]",
            "input[id*='documento' i]",
            "input[name*='doc' i]",
            "input[id*='doc' i]",
            "input[placeholder*='cpf' i]",
            "input[placeholder*='cnpj' i]",
            "input[aria-label*='cpf' i]",
            "input[aria-label*='cnpj' i]",
            "input[name*='parte' i]",
          ],
          value,
        )
      : await fillFirstInteractive(
          page,
          [
            "input[name*='nomeparte' i]",
            "input[id*='nomeparte' i]",
            "input[name*='parte' i]",
            "input[id*='parte' i]",
            "input[name*='nome' i]",
            "input[id*='nome' i]",
            "input[placeholder*='nome' i]",
          ],
          value,
        );

    if (!filled) {
      return {
        connectorFamily,
        queryMode,
        status: "unavailable",
        statusReason: "no_automatable_form",
        latencyMs: Date.now() - startedAt,
        message: "Fallback browser não encontrou campo editável para a consulta",
        evidence: [],
        processes: [],
      };
    }

    const submitted = await clickFirstVisible(page, [
      "button:has-text('Pesquisar')",
      "input[type='submit'][value*='Pesquisar' i]",
      "button:has-text('Consultar')",
      "input[type='submit'][value*='Consultar' i]",
      "button:has-text('Buscar')",
      "input[type='submit'][value*='Buscar' i]",
    ]);
    if (!submitted) {
      await page.keyboard.press("Enter").catch(() => {});
    }

    await Promise.race([
      page.waitForLoadState("networkidle", { timeout: Math.min(navTimeoutMs, 30000) }),
      page.waitForTimeout(5000),
    ]).catch(() => {});

    const html = await page.content().catch(() => "");
    const text = await page.locator("body").innerText().catch(() => "");
    const pageSource = `${text}\n${html}`;

    if (hasAccessBlock(pageSource)) {
      return {
        connectorFamily,
        queryMode,
        status: "unavailable",
        statusReason: "access_blocked",
        latencyMs: Date.now() - startedAt,
        message: "Portal bloqueou o acesso após submissão no fallback browser",
        evidence: [],
        processes: [],
      };
    }
    if (hasCaptcha(pageSource)) {
      return {
        connectorFamily,
        queryMode,
        status: "unavailable",
        statusReason: "captcha_blocked",
        latencyMs: Date.now() - startedAt,
        message: "Portal apresentou captcha após submissão no fallback browser",
        evidence: [],
        processes: [],
      };
    }

    const processes = parseProcessesFromText(pageSource, tribunalId, page.url());
    if (processes.length > 0) {
      return {
        connectorFamily,
        queryMode,
        status: "success",
        statusReason: "match_found",
        latencyMs: Date.now() - startedAt,
        message: `Fallback browser retornou ${processes.length} processo(s)`,
        evidence: [],
        processes,
      };
    }

    if (hasNoResultsMarker(pageSource)) {
      return {
        connectorFamily,
        queryMode,
        status: "not_found",
        statusReason: "not_listed",
        latencyMs: Date.now() - startedAt,
        message: "Fallback browser concluiu sem registros",
        evidence: [],
        processes: [],
      };
    }

    return {
      connectorFamily,
      queryMode,
      status: "unavailable",
      statusReason: "no_automatable_form",
      latencyMs: Date.now() - startedAt,
      message: "Fallback browser não conseguiu confirmar resultado consultável",
      evidence: [],
      processes: [],
    };
  } catch (error) {
    const message = String(error?.message ?? error ?? "erro inesperado");
    const statusReason =
      /browsertype\.launch|browser has been closed|target page, context or browser has been closed|executable doesn'?t exist|failed to launch/i.test(
        message,
      )
        ? "browser_runtime_unavailable"
        : "timeout_or_network";
    return {
      connectorFamily,
      queryMode,
      status: "unavailable",
      statusReason,
      latencyMs: Date.now() - startedAt,
      message: `Fallback browser falhou: ${message}`,
      evidence: [],
      processes: [],
    };
  } finally {
    await page?.close().catch(() => {});
    await context?.close().catch(() => {});
    await browser?.close().catch(() => {});
  }
}
