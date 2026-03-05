import crypto from "node:crypto";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, stat } from "node:fs/promises";

const execFileAsync = promisify(execFile);

const SEMIL_APP_ID = "77da778c122c4ccda8a8d6babce61b6b";
const DEFAULT_SEMIL_URL = `https://mapas.semil.sp.gov.br/portal/apps/webappviewer/index.html?id=${SEMIL_APP_ID}`;
const DEFAULT_CAPTURE_DIR = path.resolve(process.cwd(), process.env.AREAS_CAPTURE_DIR ?? "data/areas-captures");
const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

let chromiumInstallPromise = null;
let resolvedChromiumPathPromise = null;

function sanitizeFileToken(value, fallback = "capture") {
  const normalized = String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  return normalized || fallback;
}

function summarizeError(error) {
  if (!error) return "unknown_error";
  const message = error instanceof Error ? error.message : String(error);
  if (/executable doesn't exist|browser.*not found|failed to launch/i.test(message)) {
    return "chromium_not_installed";
  }
  if (/timed out|timeout/i.test(message)) return "timeout";
  if (/playwright/i.test(message)) return "playwright_runtime_error";
  return "capture_error";
}

function normalizeMapUrl({ mapUrl, razaoSocial }) {
  let url = null;
  try {
    url = new URL(String(mapUrl ?? "").trim() || DEFAULT_SEMIL_URL);
  } catch {
    url = new URL(DEFAULT_SEMIL_URL);
  }

  if (!url.searchParams.get("id")) {
    url.searchParams.set("id", SEMIL_APP_ID);
  }

  const findParam = String(razaoSocial ?? "").trim().slice(0, 140);
  if (findParam && !url.searchParams.get("find")) {
    url.searchParams.set("find", findParam);
  }

  return url.toString();
}

function formatCnpj(value) {
  const digits = String(value ?? "").replace(/\D/g, "").slice(0, 14);
  if (digits.length !== 14) return digits;
  return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
}

function buildSearchCandidates(input) {
  const candidates = [
    String(input?.razaoSocial ?? "").trim(),
    formatCnpj(input?.cnpj),
    String(input?.cnpj ?? "").replace(/\D/g, "").trim(),
  ]
    .map((item) => item.trim())
    .filter(Boolean);
  return [...new Set(candidates)].slice(0, 3);
}

async function ensureChromiumInstalled() {
  if (!chromiumInstallPromise) {
    const timeoutMs = Math.max(60_000, Number.parseInt(process.env.AREAS_CAPTURE_INSTALL_TIMEOUT_MS ?? "180000", 10) || 180_000);
    chromiumInstallPromise = execFileAsync("npx", ["playwright", "install", "chromium"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PLAYWRIGHT_BROWSERS_PATH: String(process.env.PLAYWRIGHT_BROWSERS_PATH ?? "0"),
      },
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
    })
      .catch(() => null)
      .finally(() => {
        chromiumInstallPromise = null;
      });
  }
  await chromiumInstallPromise;
}

async function resolveSystemChromiumPath() {
  if (!resolvedChromiumPathPromise) {
    resolvedChromiumPathPromise = (async () => {
      const explicit = String(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? process.env.CHROMIUM_PATH ?? "").trim();
      const directCandidates = [explicit, "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome"];
      for (const candidate of directCandidates) {
        if (!candidate) continue;
        try {
          const file = await stat(candidate);
          if (file.isFile()) return candidate;
        } catch {
          // keep trying
        }
      }

      try {
        const lookup = await execFileAsync("sh", [
          "-lc",
          "command -v chromium || command -v chromium-browser || command -v google-chrome || true",
        ]);
        const discovered = String(lookup?.stdout ?? "").trim().split(/\s+/)[0];
        if (discovered) return discovered;
      } catch {
        // ignore
      }

      return "";
    })().finally(() => {
      resolvedChromiumPathPromise = null;
    });
  }
  return resolvedChromiumPathPromise;
}

async function launchChromium() {
  const playwrightModule = await import("@playwright/test");
  const chromium = playwrightModule.chromium;
  const systemChromiumPath = await resolveSystemChromiumPath();
  const launchOptions = {
    headless: process.env.AREAS_CAPTURE_HEADLESS !== "false",
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  };

  try {
    return await chromium.launch(launchOptions);
  } catch (error) {
    const reason = summarizeError(error);
    if (reason !== "chromium_not_installed") throw error;

    if (systemChromiumPath) {
      try {
        return await chromium.launch({
          ...launchOptions,
          executablePath: systemChromiumPath,
        });
      } catch {
        // continue to playwright install fallback
      }
    }

    await ensureChromiumInstalled();
    return chromium.launch(launchOptions);
  }
}

async function ensureSearchWidgetOpen(page) {
  const alreadyOpen = page.locator(".esri-search__input").first();
  if ((await alreadyOpen.count()) > 0) {
    const visible = await alreadyOpen.isVisible().catch(() => false);
    if (visible) return true;
  }

  const openSelectors = [
    "button[aria-label*='Pesquisar']",
    "button[aria-label*='Search']",
    "button[title*='Pesquisar']",
    "button[title*='Search']",
    ".esri-widget--button[aria-label*='Search']",
    ".esri-widget--button[aria-label*='Pesquisar']",
    ".esri-search .esri-widget--button",
    ".esri-search__submit-button",
    ".esri-search__magnifier",
    ".esri-icon-search",
  ];

  for (const selector of openSelectors) {
    try {
      const button = page.locator(selector).first();
      if ((await button.count()) === 0) continue;
      if (!(await button.isVisible().catch(() => false))) continue;
      await button.click({ timeout: 2500 }).catch(() => {});
      await page.waitForTimeout(700);
      const input = page.locator(".esri-search__input").first();
      if ((await input.count()) > 0 && (await input.isVisible().catch(() => false))) {
        return true;
      }
    } catch {
      // try next selector
    }
  }

  return false;
}

async function stampCaptureContext(page, query, statusReason) {
  const safeQuery = String(query ?? "").trim();
  if (!safeQuery) return;
  const safeStatus = String(statusReason ?? "").trim() || "captured";
  await page
    .evaluate(
      ({ q, status }) => {
        const id = "codex-areas-capture-context";
        const prev = document.getElementById(id);
        if (prev) prev.remove();
        const node = document.createElement("div");
        node.id = id;
        node.style.position = "fixed";
        node.style.top = "14px";
        node.style.left = "14px";
        node.style.zIndex = "2147483647";
        node.style.maxWidth = "62vw";
        node.style.padding = "8px 10px";
        node.style.borderRadius = "8px";
        node.style.background = "rgba(15,23,42,0.90)";
        node.style.color = "#f8fafc";
        node.style.font = "600 12px/1.35 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
        node.style.boxShadow = "0 4px 18px rgba(2,6,23,0.45)";
        node.style.border = "1px solid rgba(148,163,184,0.45)";
        node.textContent = `Consulta automatizada (${status}): ${q}`;
        document.body.appendChild(node);
      },
      { q: safeQuery.slice(0, 180), status: safeStatus.slice(0, 60) }
    )
    .catch(() => {});
}

async function paintQueryInSearchInput(page, query) {
  const safeQuery = String(query ?? "").trim();
  if (!safeQuery) return false;
  const selectors = [
    ".esri-search__input",
    "input[placeholder*='Pesquisar']",
    "input[placeholder*='Search']",
    "input[type='search']",
  ];

  for (const selector of selectors) {
    try {
      const input = page.locator(selector).first();
      if ((await input.count()) === 0) continue;
      if (!(await input.isVisible().catch(() => false))) continue;
      await input.click({ timeout: 2500 }).catch(() => {});
      await input.press("Control+A", { timeout: 2500 }).catch(() => {});
      await input.press("Meta+A", { timeout: 2500 }).catch(() => {});
      await input.fill("", { timeout: 2500 }).catch(() => {});
      await input.type(safeQuery, { delay: 70, timeout: 12000 });
      await page.waitForTimeout(400);
      return true;
    } catch {
      // try next selector
    }
  }

  return false;
}

async function trySearchInViewer(page, query) {
  const safeQuery = String(query ?? "").trim();
  if (!safeQuery) return { ok: false, query: safeQuery };

  await ensureSearchWidgetOpen(page).catch(() => {});
  const filled = await paintQueryInSearchInput(page, safeQuery);
  if (!filled) return { ok: false, query: safeQuery };

  const input = page
    .locator(".esri-search__input, input[placeholder*='Pesquisar'], input[placeholder*='Search'], input[type='search']")
    .first();
  await input.press("Enter", { timeout: 4000 }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 18000 }).catch(() => {});
  await page.waitForTimeout(4200);
  // Repaint query before capture so it is visible in the screenshot.
  await paintQueryInSearchInput(page, safeQuery).catch(() => {});
  await page.waitForTimeout(500);
  return { ok: true, query: safeQuery };
}

async function waitForSemilViewerReady(page) {
  // Primeiro estágio: garantir carregamento base da página/app shell.
  await page.waitForLoadState("domcontentloaded", { timeout: 60000 });
  await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1800);

  // Segundo estágio: aguardar render real do mapa (canvas/root do ArcGIS).
  const readySelectors = [
    ".esri-view-root",
    ".esri-view-surface",
    ".esri-ui",
    "canvas.esri-display-object",
    ".esri-view-root canvas",
    ".jimu-map-view",
  ];

  let foundReadySelector = false;
  for (const selector of readySelectors) {
    try {
      const locator = page.locator(selector).first();
      if ((await locator.count()) === 0) continue;
      await locator.waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
      foundReadySelector = true;
      break;
    } catch {
      // try next selector
    }
  }

  if (!foundReadySelector) {
    await page.waitForTimeout(3500);
    return;
  }

  // Terceiro estágio: reduzir chance de screenshot durante overlay de loading.
  await page
    .waitForFunction(
      () => {
        const candidates = [
          ".esri-view-loading-indicator",
          ".jimu-loading-indicator",
          ".app-loading",
          ".loading-indicator",
          ".esri-widget--loading",
          ".esri-icon-loading-indicator",
        ];
        const isVisible = (el) => {
          if (!el) return false;
          const style = window.getComputedStyle(el);
          if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity || 1) === 0) return false;
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        };
        return !candidates.some((selector) => {
          const el = document.querySelector(selector);
          return isVisible(el);
        });
      },
      { timeout: 12000 }
    )
    .catch(() => {});

  // Folga final para tiles/camadas terminarem de pintar.
  await page.waitForTimeout(4200);
}

/**
 * @param {{
 *  mapUrl?: string;
 *  razaoSocial?: string;
 *  cnpj?: string;
 *  includeBase64?: boolean;
 * }} input
 */
export async function captureAreasContaminadasScreenshot(input = {}) {
  const startedAt = Date.now();
  const includeBase64 = input?.includeBase64 !== false;
  const mapUrl = normalizeMapUrl({
    mapUrl: input?.mapUrl,
    razaoSocial: input?.razaoSocial,
  });
  const cnpjToken = sanitizeFileToken(String(input?.cnpj ?? ""), "no-cnpj");
  const nameToken = sanitizeFileToken(String(input?.razaoSocial ?? ""), "no-name");
  const randomToken = crypto.randomBytes(4).toString("hex");
  const fileName = `areas-${cnpjToken}-${nameToken}-${Date.now()}-${randomToken}.png`;

  let browser = null;
  let context = null;
  let page = null;

  try {
    await mkdir(DEFAULT_CAPTURE_DIR, { recursive: true });

    browser = await launchChromium();
    context = await browser.newContext({
      ignoreHTTPSErrors: true,
      userAgent: DEFAULT_USER_AGENT,
      viewport: { width: 1440, height: 1900 },
    });
    page = await context.newPage();
    page.setDefaultTimeout(Math.max(20_000, Number.parseInt(process.env.AREAS_CAPTURE_TIMEOUT_MS ?? "50000", 10) || 50_000));

    await page.goto(mapUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await waitForSemilViewerReady(page);

    let searchAttempt = { ok: false, query: "" };
    const searchCandidates = buildSearchCandidates(input);
    for (const candidate of searchCandidates) {
      searchAttempt = await trySearchInViewer(page, candidate);
      if (searchAttempt.ok) break;
    }

    if (searchAttempt.ok) {
      await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(5500);
    } else {
      await page.waitForTimeout(4500);
    }

    const contextQuery = searchAttempt.ok ? searchAttempt.query : searchCandidates[0] || formatCnpj(input?.cnpj) || "";
    await stampCaptureContext(page, contextQuery, searchAttempt.ok ? "search_applied" : "search_fallback");
    await page.waitForTimeout(550);

    const filePath = path.join(DEFAULT_CAPTURE_DIR, fileName);
    await page.screenshot({
      path: filePath,
      fullPage: process.env.AREAS_CAPTURE_FULL_PAGE === "true",
      type: "png",
    });

    const fileStats = await stat(filePath);
    const base64 = includeBase64 ? (await readFile(filePath)).toString("base64") : null;

    return {
      available: true,
      status: "success",
      status_reason: searchAttempt.ok ? "captured_after_search" : "captured_with_overlay",
      message: searchAttempt.ok
        ? `Screenshot capturado apos busca no viewer pelo termo: ${searchAttempt.query}.`
        : "Screenshot capturado com selo de consulta; o widget de busca nao foi preenchido automaticamente nesta execucao.",
      map_url: mapUrl,
      file_name: fileName,
      file_path: filePath,
      mime_type: "image/png",
      bytes: Number(fileStats.size ?? 0),
      image_base64: base64,
      captured_at: new Date().toISOString(),
      latency_ms: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      available: false,
      status: "error",
      status_reason: summarizeError(error),
      message: error instanceof Error ? error.message : "Falha ao capturar screenshot de areas contaminadas.",
      map_url: mapUrl,
      file_name: null,
      file_path: null,
      mime_type: "image/png",
      bytes: 0,
      image_base64: null,
      captured_at: new Date().toISOString(),
      latency_ms: Date.now() - startedAt,
    };
  } finally {
    if (page) await page.close().catch(() => {});
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }
}
