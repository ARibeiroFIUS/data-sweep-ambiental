import { expect, Page, TestInfo } from "@playwright/test";

export type TribunalSmokeTarget = {
  tribunalId: string;
  tribunalName: string;
  url: string;
};

type DomSummary = {
  title: string;
  forms: number;
  inputs: number;
  buttons: number;
  selects: number;
  links: number;
  hasCaptchaHint: boolean;
  hasSearchHint: boolean;
  textPreview: string;
};

async function inspectDom(page: Page): Promise<DomSummary> {
  return page.evaluate(() => {
    const count = (selector: string) => document.querySelectorAll(selector).length;
    const text = String(document.body?.innerText ?? "").replace(/\s+/g, " ").trim();
    const html = String(document.documentElement?.innerHTML ?? "");
    const captchaRegex = /(captcha|h-captcha|recaptcha|nao sou robo|não sou robô|sou humano)/i;
    const searchRegex =
      /(consulta pública|consulta processual|número do processo|numero do processo|pesquisar|search|classe judicial|parte)/i;

    return {
      title: document.title || "",
      forms: count("form"),
      inputs: count("input"),
      buttons: count("button"),
      selects: count("select"),
      links: count("a"),
      hasCaptchaHint: captchaRegex.test(text) || captchaRegex.test(html),
      hasSearchHint: searchRegex.test(text) || searchRegex.test(html),
      textPreview: text.slice(0, 1200),
    };
  });
}

export async function runTribunalSmoke(page: Page, testInfo: TestInfo, target: TribunalSmokeTarget) {
  const startedAt = new Date().toISOString();
  let status: number | null = null;
  let finalUrl = target.url;
  let navigationError: string | null = null;

  try {
    const response = await page.goto(target.url, { waitUntil: "domcontentloaded" });
    status = response?.status() ?? null;
    await page.waitForTimeout(2000);
    finalUrl = page.url();
  } catch (error) {
    navigationError = String((error as Error)?.message ?? error);
    finalUrl = page.url() || target.url;
  }

  const dom = await inspectDom(page);

  const screenshotBuffer = await page.screenshot({ fullPage: true }).catch(() => null);
  if (screenshotBuffer) {
    await testInfo.attach(`${target.tribunalId}-screenshot`, {
      body: screenshotBuffer,
      contentType: "image/png",
    });
  }

  const html = await page.content().catch(() => "");
  await testInfo.attach(`${target.tribunalId}-html`, {
    body: Buffer.from(html, "utf8"),
    contentType: "text/html",
  });

  const metadata = {
    tribunalId: target.tribunalId,
    tribunalName: target.tribunalName,
    targetUrl: target.url,
    finalUrl,
    status,
    navigationError,
    startedAt,
    finishedAt: new Date().toISOString(),
    dom,
  };
  await testInfo.attach(`${target.tribunalId}-metadata`, {
    body: Buffer.from(JSON.stringify(metadata, null, 2), "utf8"),
    contentType: "application/json",
  });

  expect(navigationError, `${target.tribunalId}: navigation error`).toBeNull();
  expect(status, `${target.tribunalId}: HTTP status expected`).not.toBeNull();
  expect((status ?? 0) < 500, `${target.tribunalId}: status should be < 500`).toBeTruthy();

  const hasInteractionSurface = dom.forms + dom.inputs + dom.buttons + dom.selects > 0;
  const hasExpectedContent = dom.hasSearchHint || dom.hasCaptchaHint;
  expect(
    hasInteractionSurface || hasExpectedContent,
    `${target.tribunalId}: page should expose search UI or explicit captcha hint`,
  ).toBeTruthy();
}

