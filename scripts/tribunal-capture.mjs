import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";
import { findTribunal, loadTribunalDataset, parseCliArgs } from "./tribunal-dataset.mjs";

function printUsage() {
  console.log("Usage:");
  console.log("  npm run tribunal:capture -- --tribunal <id> [--dataset <path>] [--outdir artifacts/captures] [--headed]");
  console.log("  npm run tribunal:capture -- --url <url> [--name <id>] [--outdir artifacts/captures] [--headed]");
}

function normalizeId(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function nowStamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}-${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;
}

async function main() {
  const options = parseCliArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    process.exit(0);
  }

  const timeoutMs = Number.parseInt(String(options.timeout ?? "30000"), 10);
  const waitMs = Number.parseInt(String(options.wait ?? "2500"), 10);
  const headed = Boolean(options.headed);

  let tribunalId = "";
  let tribunalName = "";
  let targetUrl = String(options.url ?? "").trim();

  if (!targetUrl) {
    tribunalId = String(options.tribunal ?? "").trim().toLowerCase();
    if (!tribunalId) {
      printUsage();
      throw new Error('Missing required argument: --tribunal "<id>" or --url "<url>"');
    }

    const { datasetPath, rows } = loadTribunalDataset(options.dataset);
    const tribunal = findTribunal(rows, tribunalId);
    if (!tribunal) {
      throw new Error(`Tribunal not found: ${tribunalId}`);
    }
    targetUrl = tribunal.consulta_publica_url;
    tribunalName = tribunal.nome;
    console.log(`Dataset: ${datasetPath}`);
  } else {
    tribunalId = normalizeId(options.name || new URL(targetUrl).hostname || "custom-url");
    tribunalName = "Custom URL";
  }

  if (!targetUrl) {
    throw new Error("Target URL is empty");
  }

  const captureBase = path.resolve(
    process.cwd(),
    String(options.outdir ?? "artifacts/captures"),
    normalizeId(tribunalId) || "tribunal",
    nowStamp(),
  );
  fs.mkdirSync(captureBase, { recursive: true });

  const screenshotPath = path.join(captureBase, "page.png");
  const htmlPath = path.join(captureBase, "page.html");
  const metadataPath = path.join(captureBase, "metadata.json");
  const requestsPath = path.join(captureBase, "requests.json");
  const harPath = path.join(captureBase, "network.har");

  console.log(`Tribunal: ${tribunalId} - ${tribunalName || "N/A"}`);
  console.log(`URL: ${targetUrl}`);
  console.log(`Capture dir: ${captureBase}`);

  const browser = await chromium.launch({ headless: !headed });
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    recordHar: { path: harPath, mode: "minimal" },
    viewport: { width: 1440, height: 1800 },
    userAgent: "Mozilla/5.0 (compatible; data-sweep-engine/1.0; tribunal-capture)",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(timeoutMs);

  const requests = [];
  page.on("request", (request) => {
    if (requests.length >= 250) return;
    requests.push({
      method: request.method(),
      resourceType: request.resourceType(),
      url: request.url(),
    });
  });

  let navigationError = null;
  let status = null;
  let finalUrl = targetUrl;

  try {
    const response = await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    status = response?.status() ?? null;
    if (waitMs > 0) {
      await page.waitForTimeout(waitMs);
    }
    finalUrl = page.url();
  } catch (error) {
    navigationError = String(error?.message ?? error);
    finalUrl = page.url() || targetUrl;
  }

  await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
  const html = await page.content().catch(() => "");
  fs.writeFileSync(htmlPath, html, "utf8");

  const domSummary = await page
    .evaluate(() => {
      const count = (selector) => document.querySelectorAll(selector).length;
      const bodyText = String(document.body?.innerText ?? "").replace(/\s+/g, " ").trim();
      const html = String(document.documentElement?.innerHTML ?? "");
      const captchaRegex = /(captcha|h-captcha|recaptcha|nao sou robo|não sou robô|sou humano)/i;
      return {
        title: document.title || "",
        forms: count("form"),
        inputs: count("input"),
        buttons: count("button"),
        selects: count("select"),
        links: count("a"),
        hasCaptchaHint: captchaRegex.test(bodyText) || captchaRegex.test(html),
        textPreview: bodyText.slice(0, 1200),
      };
    })
    .catch(() => ({
      title: "",
      forms: 0,
      inputs: 0,
      buttons: 0,
      selects: 0,
      links: 0,
      hasCaptchaHint: false,
      textPreview: "",
    }));

  fs.writeFileSync(
    metadataPath,
    JSON.stringify(
      {
        tribunalId,
        tribunalName,
        targetUrl,
        finalUrl,
        status,
        timeoutMs,
        waitMs,
        navigationError,
        capturedAt: new Date().toISOString(),
        domSummary,
        files: {
          screenshot: path.basename(screenshotPath),
          html: path.basename(htmlPath),
          metadata: path.basename(metadataPath),
          requests: path.basename(requestsPath),
          har: path.basename(harPath),
        },
      },
      null,
      2,
    ),
  );

  fs.writeFileSync(requestsPath, JSON.stringify({ total: requests.length, requests }, null, 2));

  await context.close();
  await browser.close();

  if (navigationError) {
    console.error(`Capture finished with navigation error: ${navigationError}`);
    process.exit(2);
  }

  console.log("Capture finished successfully.");
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});

