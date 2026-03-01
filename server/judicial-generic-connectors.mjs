import { cleanDocument, normalizePersonName } from "./common-utils.mjs";
import { fetchWithTimeout } from "./http-utils.mjs";

const PJE_HOST_ALIASES = {
  trt2: ["trtsp"],
  trt17: ["trtes"],
  tjpi: ["tjpi.pje.jus.br"],
  tjrj: ["tjrj.pje.jus.br"],
  tjes: ["sistemas.tjes.jus.br"],
  tjdft: ["pje2i.tjdft.jus.br"],
  tjma: ["pje2.tjma.jus.br"],
  tjmt: ["pje2.tjmt.jus.br"],
  trf1: ["pje1g.trf1.jus.br", "pje2g.trf1.jus.br"],
  trf3: ["pje1g.trf3.jus.br", "pje2g.trf3.jus.br"],
  trf5: ["pje1g.trf5.jus.br", "pje2g.trf5.jus.br"],
};

const EPROC_BASE_BY_TRIBUNAL = {
  trf4: "https://eproc.trf4.jus.br/eproc2trf4",
  tjms: "https://eproc.tjms.jus.br/eprocV2",
  tjrs: "https://eproc1g.tjrs.jus.br/eproc",
  tjsc: "https://eproc1g.tjsc.jus.br/eproc",
  tjto: "https://eproc1g.tjto.jus.br/eprocV2_prod_1grau",
};

const DEFAULT_HEADERS = {
  "User-Agent": "Mozilla/5.0 (compatible; data-sweep-engine/1.0; +https://railway.app)",
  accept: "text/html,application/xhtml+xml",
};
const DEFAULT_FETCH_RETRIES = Number.parseInt(process.env.JUDICIAL_CONNECTOR_FETCH_RETRIES ?? "2", 10);
const DEFAULT_RETRY_DELAY_MS = Number.parseInt(process.env.JUDICIAL_CONNECTOR_RETRY_DELAY_MS ?? "400", 10);
const DEFAULT_RETRY_JITTER_MS = Number.parseInt(process.env.JUDICIAL_CONNECTOR_RETRY_JITTER_MS ?? "250", 10);

function createHttpSession() {
  return { cookies: new Map() };
}

function parseSetCookieHeaders(response) {
  const headers = response?.headers;
  if (!headers) return [];
  if (typeof headers.getSetCookie === "function") {
    try {
      const values = headers.getSetCookie();
      return Array.isArray(values) ? values : [];
    } catch {
      return [];
    }
  }
  const single = headers.get("set-cookie");
  if (!single) return [];
  return single
    .split(/,(?=[^;,=\s]+=[^;,]*)/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

function storeResponseCookies(session, response) {
  if (!session?.cookies) return;
  for (const cookie of parseSetCookieHeaders(response)) {
    const firstPart = String(cookie).split(";")[0] ?? "";
    const divider = firstPart.indexOf("=");
    if (divider <= 0) continue;
    const key = firstPart.slice(0, divider).trim();
    const value = firstPart.slice(divider + 1).trim();
    if (!key) continue;
    session.cookies.set(key, value);
  }
}

function buildCookieHeader(session) {
  if (!session?.cookies || session.cookies.size === 0) return "";
  return Array.from(session.cookies.entries())
    .map(([key, value]) => `${key}=${value}`)
    .join("; ");
}

function decodeHtml(value) {
  return String(value ?? "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function isRetriableHttpStatus(status) {
  const code = Number(status);
  if (!Number.isFinite(code)) return false;
  if (code === 408 || code === 425 || code === 429) return true;
  if (code >= 500 && code <= 504) return true;
  if (code === 522 || code === 524) return true;
  return false;
}

function computeRetryDelayMs(attempt) {
  const safeAttempt = Math.max(0, Number(attempt) || 0);
  const base = Math.max(50, DEFAULT_RETRY_DELAY_MS) * (2 ** safeAttempt);
  const jitter = Math.floor(Math.random() * Math.max(1, DEFAULT_RETRY_JITTER_MS));
  return Math.min(base + jitter, 5000);
}

function stripTags(value) {
  return decodeHtml(String(value ?? "").replace(/<[^>]+>/g, " "));
}

function isCaptchaPage(html) {
  const source = String(html ?? "");
  const lower = source.toLowerCase();
  const hasChallengeInput = /<input[^>]+name="answer"/i.test(source) || /<img[^>]+id="captcha/i.test(source);
  return (
    lower.includes("g-recaptcha") ||
    lower.includes("h-captcha") ||
    lower.includes("tencentcaptcha") ||
    lower.includes("digite os caracteres da imagem") ||
    lower.includes("sou humano") ||
    lower.includes("não sou robô") ||
    lower.includes("nao sou robo") ||
    hasChallengeInput
  );
}

function isLoginPage(html) {
  const lower = String(html ?? "").toLowerCase();
  const hasLoginWord = lower.includes("login") || lower.includes("entrar") || lower.includes("acesso");
  const hasPjeBrand = lower.includes("bem-vindo ao pje") || lower.includes("processo judicial eletrônico");
  return hasLoginWord && hasPjeBrand;
}

function isPublicSearchDisabledPage(html) {
  const source = String(html ?? "");
  const lower = source.toLowerCase();
  return (
    lower.includes("consulta pública está desativada") ||
    lower.includes("consulta publica está desativada") ||
    lower.includes("consulta pública indisponível") ||
    lower.includes("consulta publica indisponivel") ||
    /consulta\s+p.{0,2}blica\s+est.{0,2}\s+desativada/i.test(source)
  );
}

function isAccessBlockedPage(html, statusCode = 0) {
  const source = String(html ?? "");
  const lower = source.toLowerCase();
  const text = stripTags(source).toLowerCase();
  return (
    statusCode === 401 ||
    statusCode === 403 ||
    /^forbidden$/i.test(source.trim()) ||
    lower.includes("acesso negado") ||
    lower.includes("acesso bloqueado") ||
    lower.includes("bloqueio temporário") ||
    lower.includes("bloqueio temporario") ||
    text.includes("bloqueio temporário") ||
    text.includes("bloqueio temporario") ||
    text.includes("portal institucional") ||
    lower.includes("request blocked")
  );
}

function parseValidationErrors(html) {
  const errors = [];
  const ulMatch = String(html ?? "").match(/<ul[^>]*id="ulMensErros"[^>]*>([\s\S]*?)<\/ul>/i);
  if (!ulMatch) return errors;
  const liRegex = /<li[^>]*>([\s\S]*?)<\/li>/gi;
  let liMatch;
  while ((liMatch = liRegex.exec(ulMatch[1])) !== null) {
    const message = stripTags(liMatch[1]);
    if (!message) continue;
    errors.push(message);
  }
  return errors;
}

function hasNoResultsMarker(html) {
  return /nenhum resultado|nenhum processo|não foram encontrados|nao foram encontrados|nenhum registro encontrado|sem registros/i.test(
    String(html ?? ""),
  );
}

function parseForms(html, baseUrl) {
  const forms = [];
  const formRegex = /<form\b([^>]*)>([\s\S]*?)<\/form>/gi;
  let formMatch;
  while ((formMatch = formRegex.exec(String(html ?? ""))) !== null) {
    const attrs = formMatch[1] ?? "";
    const body = formMatch[2] ?? "";
    const actionRaw = attrs.match(/\baction="([^"]*)"/i)?.[1] ?? "";
    const method = (attrs.match(/\bmethod="([^"]*)"/i)?.[1] ?? "get").toLowerCase();
    const id = attrs.match(/\bid="([^"]*)"/i)?.[1] ?? attrs.match(/\bname="([^"]*)"/i)?.[1] ?? "";

    let actionUrl = "";
    try {
      actionUrl = actionRaw ? new URL(actionRaw, baseUrl).toString() : baseUrl;
    } catch {
      actionUrl = baseUrl;
    }

    const inputs = [];
    const inputRegex = /<(input|button|textarea)\b([^>]*)>/gi;
    let inputMatch;
    while ((inputMatch = inputRegex.exec(body)) !== null) {
      const tag = String(inputMatch[1] ?? "").toLowerCase();
      const inputAttrs = inputMatch[2] ?? "";
      const name = inputAttrs.match(/\bname="([^"]*)"/i)?.[1] ?? "";
      if (!name) continue;
      const value = inputAttrs.match(/\bvalue="([^"]*)"/i)?.[1] ?? "";
      const type = (inputAttrs.match(/\btype="([^"]*)"/i)?.[1] ?? (tag === "button" ? "submit" : "text")).toLowerCase();
      const checked = /\bchecked(?:="checked")?/i.test(inputAttrs);
      inputs.push({ tag, name, value, type, checked, options: undefined });
    }

    const selectRegex = /<select\b([^>]*)>([\s\S]*?)<\/select>/gi;
    let selectMatch;
    while ((selectMatch = selectRegex.exec(body)) !== null) {
      const selectAttrs = selectMatch[1] ?? "";
      const selectBody = selectMatch[2] ?? "";
      const name = selectAttrs.match(/\bname="([^"]*)"/i)?.[1] ?? "";
      if (!name) continue;
      const options = [];
      const optionRegex = /<option\b([^>]*)>([\s\S]*?)<\/option>/gi;
      let optionMatch;
      while ((optionMatch = optionRegex.exec(selectBody)) !== null) {
        const optionAttrs = optionMatch[1] ?? "";
        const optionValue = optionAttrs.match(/\bvalue="([^"]*)"/i)?.[1] ?? "";
        const selected = /\bselected(?:="selected")?/i.test(optionAttrs);
        options.push({ value: optionValue, selected });
      }

      const selectedOption = options.find((item) => item.selected) ?? options[0] ?? { value: "" };
      inputs.push({
        tag: "select",
        name,
        value: selectedOption.value ?? "",
        type: "select",
        checked: false,
        options,
      });
    }

    forms.push({ id, method, actionUrl, inputs });
  }
  return forms;
}

function scoreFormForQuery(form, queryMode) {
  const names = form.inputs.map((item) => String(item.name ?? "").toLowerCase());
  let score = 0;
  if (names.some((name) => name.includes("viewstate"))) score += 2;
  if (names.some((name) => name.includes("search") || name.includes("pesquisa") || name.includes("consulta"))) score += 2;
  if (queryMode === "cnpj_exact") {
    if (names.some((name) => /cnpj|cpf|documento|doc|parte/.test(name))) score += 4;
  } else if (queryMode === "party_name") {
    if (names.some((name) => /nome|parte|autor|reu|réu|demandante|reclamante/.test(name))) score += 4;
  } else if (queryMode === "process_number") {
    if (names.some((name) => /processo|num|numero|referencia/.test(name))) score += 4;
  }
  return score;
}

function pickTargetFields(form, queryMode) {
  const candidates = form.inputs
    .filter((item) => item.type !== "hidden")
    .map((item) => item.name)
    .filter(Boolean);
  if (candidates.length === 0) return [];

  const regexes =
    queryMode === "cnpj_exact"
      ? [/cnpj|cpfcnpj/i, /documento|doc/i, /parte/i, /cpf/i]
      : queryMode === "party_name"
        ? [/nome.*parte|parte.*nome/i, /nome/i, /autor|reu|réu|demandante|reclamante/i]
        : [/processo|referencia|numero|num/i];

  for (const regex of regexes) {
    const matched = candidates.filter((name) => regex.test(name));
    if (matched.length > 0) return matched.slice(0, 3);
  }
  return candidates.slice(0, 1);
}

function buildFormData(form, queryMode, queryValue) {
  const params = new URLSearchParams();
  for (const input of form.inputs) {
    if (!input?.name) continue;
    if (input.type === "submit" || input.type === "button" || input.type === "image" || input.type === "file") {
      continue;
    }
    if ((input.type === "checkbox" || input.type === "radio") && !input.checked) {
      continue;
    }
    params.set(input.name, input.value ?? "");
  }

  const targetFields = pickTargetFields(form, queryMode);
  for (const field of targetFields) {
    params.set(field, queryValue);
  }

  const submit =
    form.inputs.find((item) => item.type === "submit" || item.type === "button") ??
    form.inputs.find((item) => /search|pesquisa|consulta/i.test(item.name));
  if (submit?.name) {
    params.set(submit.name, submit.value || "Pesquisar");
  }

  return params;
}

function parseProcessesFromHtml(html, tribunalId, sourceUrl) {
  const processes = [];
  const unique = new Set();
  const text = stripTags(html);
  const processRegex = /\b\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}\b/g;
  const numbers = text.match(processRegex) ?? [];

  for (const numero of numbers.slice(0, 120)) {
    if (unique.has(numero)) continue;
    unique.add(numero);
    processes.push({
      tribunal: tribunalId,
      numeroProcesso: numero,
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
    });
  }

  return processes;
}

async function fetchHtmlWithSession(url, timeoutMs, session, refererUrl = "") {
  const cookieHeader = buildCookieHeader(session);
  const headers = {
    ...DEFAULT_HEADERS,
    ...(cookieHeader ? { cookie: cookieHeader } : {}),
    ...(refererUrl ? { referer: refererUrl } : {}),
  };
  if (refererUrl) {
    try {
      headers.origin = new URL(refererUrl).origin;
    } catch {
      // ignore invalid referer
    }
  }

  for (let attempt = 0; attempt <= DEFAULT_FETCH_RETRIES; attempt += 1) {
    const response = await fetchWithTimeout(url, timeoutMs, {
      headers,
      redirect: "follow",
    });
    if (!response) {
      if (attempt < DEFAULT_FETCH_RETRIES) {
        await sleep(computeRetryDelayMs(attempt));
        continue;
      }
      return { ok: false, status: 0, reason: "timeout_or_network", url, html: "" };
    }

    storeResponseCookies(session, response);
    if (!response.ok) {
      const statusCode = Number(response.status) || 0;
      const reason =
        statusCode === 401 || statusCode === 403
          ? "access_blocked"
          : `http_${statusCode}`;
      if (attempt < DEFAULT_FETCH_RETRIES && isRetriableHttpStatus(statusCode)) {
        await sleep(computeRetryDelayMs(attempt));
        continue;
      }
      return {
        ok: false,
        status: statusCode,
        reason,
        url: response.url ?? url,
        html: "",
      };
    }

    const html = await response.text().catch(() => "");
    return {
      ok: true,
      status: response.status,
      reason: "ok",
      url: response.url ?? url,
      html,
    };
  }

  return { ok: false, status: 0, reason: "timeout_or_network", url, html: "" };
}

async function submitForm({ form, timeoutMs, queryMode, queryValue, session, refererUrl, fieldOverrides = {} }) {
  const params = buildFormData(form, queryMode, queryValue);
  for (const [key, value] of Object.entries(fieldOverrides ?? {})) {
    params.set(key, value == null ? "" : String(value));
  }
  const method = form.method === "get" ? "GET" : "POST";
  let requestUrl = form.actionUrl;
  let body = undefined;

  if (method === "GET") {
    const url = new URL(form.actionUrl);
    params.forEach((value, key) => url.searchParams.set(key, value));
    requestUrl = url.toString();
  } else {
    body = params.toString();
  }

  const cookieHeader = buildCookieHeader(session);
  const headers = {
    ...DEFAULT_HEADERS,
    ...(method === "POST" ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    ...(cookieHeader ? { cookie: cookieHeader } : {}),
    ...(refererUrl ? { referer: refererUrl } : {}),
  };
  if (refererUrl) {
    try {
      headers.origin = new URL(refererUrl).origin;
    } catch {
      // ignore invalid referer
    }
  }

  for (let attempt = 0; attempt <= DEFAULT_FETCH_RETRIES; attempt += 1) {
    const response = await fetchWithTimeout(requestUrl, timeoutMs, {
      method,
      headers,
      body,
      redirect: "follow",
    });
    if (!response) {
      if (attempt < DEFAULT_FETCH_RETRIES) {
        await sleep(computeRetryDelayMs(attempt));
        continue;
      }
      return { ok: false, reason: "timeout_or_network", html: "", status: 0, url: requestUrl };
    }

    storeResponseCookies(session, response);
    if (!response.ok) {
      const statusCode = Number(response.status) || 0;
      const reason =
        statusCode === 401 || statusCode === 403
          ? "access_blocked"
          : `http_${statusCode}`;
      if (attempt < DEFAULT_FETCH_RETRIES && isRetriableHttpStatus(statusCode)) {
        await sleep(computeRetryDelayMs(attempt));
        continue;
      }
      return {
        ok: false,
        reason,
        html: "",
        status: statusCode,
        url: response.url ?? requestUrl,
      };
    }

    const html = await response.text().catch(() => "");
    return {
      ok: true,
      reason: "ok",
      html,
      status: response.status,
      url: response.url ?? requestUrl,
    };
  }

  return { ok: false, reason: "timeout_or_network", html: "", status: 0, url: requestUrl };
}

function buildPjeCandidates(tribunalId) {
  const hosts = new Set();
  const aliases = PJE_HOST_ALIASES[tribunalId] ?? [];
  for (const alias of aliases) {
    if (alias.includes(".")) {
      hosts.add(alias);
      continue;
    }
    hosts.add(`pje.${alias}.jus.br`);
    hosts.add(`consultapublicapje.${alias}.jus.br`);
    hosts.add(`pje-consulta-publica.${alias}.jus.br`);
  }
  hosts.add(`pje.${tribunalId}.jus.br`);
  hosts.add(`consultapublicapje.${tribunalId}.jus.br`);
  hosts.add(`pje-consulta-publica.${tribunalId}.jus.br`);
  hosts.add(`pje1g.${tribunalId}.jus.br`);
  hosts.add(`pje2g.${tribunalId}.jus.br`);

  const paths = [
    "/pje/ConsultaPublica/listView.seam",
    "/primeirograu/ConsultaPublica/listView.seam",
    "/segundograu/ConsultaPublica/listView.seam",
    "/pje1grau/ConsultaPublica/listView.seam",
    "/pje2grau/ConsultaPublica/listView.seam",
    "/1g/ConsultaPublica/listView.seam",
    "/2g/ConsultaPublica/listView.seam",
    "/pg/ConsultaPublica/listView.seam",
    "/sg/ConsultaPublica/listView.seam",
    "/consultapublica/ConsultaPublica/listView.seam",
    "/ConsultaPublica/listView.seam",
  ];

  const candidates = [];
  for (const host of hosts) {
    for (const path of paths) {
      candidates.push(`https://${host}${path}`);
    }
  }
  return candidates;
}

function buildEprocCandidates(tribunalId) {
  const base = EPROC_BASE_BY_TRIBUNAL[tribunalId] ?? `https://eproc.${tribunalId}.jus.br/eproc`;
  return [`${base}/externo_controlador.php?acao=processo_consulta_publica`];
}

function buildProjudiCandidates(tribunalId) {
  const host = tribunalId === "tjpr" ? "projudi.tjpr.jus.br" : `projudi.${tribunalId}.jus.br`;
  return [
    `https://${host}/projudi_consulta/processo/consultaPublica.do?actionType=iniciar`,
    `https://${host}/projudi_consulta/`,
    `https://${host}/projudi/consultaPublica.do?actionType=iniciar`,
    `https://${host}/projudi/`,
  ];
}

function buildCustomCandidates(tribunalId) {
  if (tribunalId.startsWith("tre-")) {
    const uf = tribunalId.split("-")[1];
    return [
      `https://www.tre-${uf}.jus.br/servicos-judiciais/pje/consulta-processual`,
      "https://consultaunificadapje.tse.jus.br/",
    ];
  }
  return [];
}

function buildCandidateUrls(connectorFamily, tribunal) {
  const explicitBase = String(tribunal?.config_json?.base_url ?? "").trim();
  const tribunalId = String(tribunal?.tribunal_id ?? "").toLowerCase();
  const derivedCandidates = (() => {
    if (!tribunalId) return [];
    if (connectorFamily === "pje") return buildPjeCandidates(tribunalId);
    if (connectorFamily === "eproc") return buildEprocCandidates(tribunalId);
    if (connectorFamily === "projudi") return buildProjudiCandidates(tribunalId);
    if (connectorFamily === "custom") return buildCustomCandidates(tribunalId);
    return [];
  })();

  const combined = [
    ...(explicitBase ? [explicitBase] : []),
    ...derivedCandidates,
  ];
  return Array.from(new Set(combined.filter(Boolean)));
}

function discoverSearchLinks(html, baseUrl, connectorFamily) {
  const source = String(html ?? "");
  const links = [];
  const hrefRegex = /<a\b[^>]*href="([^"]+)"[^>]*>/gi;
  let match;
  while ((match = hrefRegex.exec(source)) !== null) {
    const href = String(match[1] ?? "").trim();
    if (!href || href.startsWith("javascript:") || href.startsWith("#")) continue;
    let absolute = "";
    try {
      absolute = new URL(href, baseUrl).toString();
    } catch {
      continue;
    }
    const lower = absolute.toLowerCase();
    const useful =
      (connectorFamily === "pje" &&
        (lower.includes("consultapublica/listview.seam") || lower.includes("/consultapublica/"))) ||
      (connectorFamily === "esaj" &&
        (lower.includes("/cpopg/open.do") || lower.includes("/cpopg/search.do") || lower.includes("/cposg/open.do"))) ||
      (connectorFamily === "eproc" && lower.includes("externo_controlador.php?acao=processo_consulta_publica")) ||
      (connectorFamily === "projudi" && lower.includes("consultapublica.do")) ||
      (connectorFamily === "custom" && (lower.includes("consulta-processual") || lower.includes("consultapublica")));
    if (useful) links.push(absolute);
  }
  return Array.from(new Set(links)).slice(0, 6);
}

function validateQueryInput(queryMode, document, name, processNumber) {
  if (queryMode === "cnpj_exact") {
    const clean = cleanDocument(document);
    if (clean.length !== 14) {
      return { ok: false, status: "invalid", statusReason: "invalid_cnpj", value: "", message: "CNPJ inválido para consulta judicial" };
    }
    return { ok: true, value: clean };
  }
  if (queryMode === "party_name") {
    const raw = String(name ?? "").trim();
    const tokenCount = normalizePersonName(raw).split(" ").filter(Boolean).length;
    if (tokenCount < 2) {
      return { ok: false, status: "invalid", statusReason: "invalid_party_name", value: "", message: "Nome insuficiente para consulta judicial" };
    }
    return { ok: true, value: raw };
  }
  if (queryMode === "process_number") {
    const raw = String(processNumber ?? "").trim();
    if (raw.length < 10) {
      return {
        ok: false,
        status: "invalid",
        statusReason: "invalid_process_number",
        value: "",
        message: "Número de processo inválido",
      };
    }
    return { ok: true, value: raw };
  }
  return {
    ok: false,
    status: "unavailable",
    statusReason: "unsupported_query_mode",
    value: "",
    message: `Modo ${queryMode} não suportado`,
  };
}

export async function runGenericTribunalConnector({
  connectorFamily,
  tribunal,
  queryMode,
  document,
  name,
  processNumber,
  timeoutMs,
}) {
  const startedAt = Date.now();
  const tribunalId = String(tribunal?.tribunal_id ?? "").toLowerCase();
  const effectiveTimeoutMs =
    connectorFamily === "pje" || connectorFamily === "eproc"
      ? Math.max(timeoutMs, 16000)
      : timeoutMs;
  const valid = validateQueryInput(queryMode, document, name, processNumber);
  if (!valid.ok) {
    return {
      connectorFamily,
      queryMode,
      status: valid.status,
      statusReason: valid.statusReason,
      latencyMs: Date.now() - startedAt,
      message: valid.message,
      evidence: [],
      processes: [],
    };
  }

  const initialCandidates = buildCandidateUrls(connectorFamily, tribunal);
  if (initialCandidates.length === 0) {
    return {
      connectorFamily,
      queryMode,
      status: "unavailable",
      statusReason: "invalid_tribunal",
      latencyMs: Date.now() - startedAt,
      message: "URL de consulta pública não configurada para o tribunal",
      evidence: [],
      processes: [],
    };
  }
  const maxCandidates =
    connectorFamily === "pje"
      ? 28
      : connectorFamily === "custom"
        ? 20
        : 14;
  const queue = [...initialCandidates];
  const visited = new Set();

  let firstReachableHtml = "";
  let reachableUrl = "";
  let lastUnavailableReason = "timeout_or_network";
  let triedSubmission = false;
  let observedCaptcha = false;
  let observedLogin = false;
  const validationErrorsSeen = [];

  while (queue.length > 0 && visited.size < maxCandidates) {
    const candidate = queue.shift();
    if (!candidate || visited.has(candidate)) continue;
    visited.add(candidate);

    const session = createHttpSession();
    const page = await fetchHtmlWithSession(candidate, effectiveTimeoutMs, session);
    if (!page.ok) {
      lastUnavailableReason = page.reason;
      continue;
    }

    firstReachableHtml = page.html;
    reachableUrl = page.url;

    if (isCaptchaPage(page.html)) {
      observedCaptcha = true;
    }
    if (isLoginPage(page.html)) {
      observedLogin = true;
    }
    if (isAccessBlockedPage(page.html, page.status)) {
      return {
        connectorFamily,
        queryMode,
        status: "unavailable",
        statusReason: "access_blocked",
        latencyMs: Date.now() - startedAt,
        message: "Portal bloqueou o acesso da automação para consulta pública",
        evidence: [],
        processes: [],
      };
    }
    if (isPublicSearchDisabledPage(page.html)) {
      return {
        connectorFamily,
        queryMode,
        status: "unavailable",
        statusReason: "public_query_disabled",
        latencyMs: Date.now() - startedAt,
        message: "Portal informa que a consulta pública está desativada",
        evidence: [],
        processes: [],
      };
    }

    const forms = parseForms(page.html, page.url).filter((form) => Array.isArray(form.inputs) && form.inputs.length > 0);
    if (forms.length === 0) {
      const directProcesses = parseProcessesFromHtml(page.html, tribunalId, page.url);
      if (directProcesses.length > 0) {
        return {
          connectorFamily,
          queryMode,
          status: "success",
          statusReason: "match_found",
          latencyMs: Date.now() - startedAt,
          message: `Consulta pública retornou ${directProcesses.length} processo(s)`,
          evidence: [],
          processes: directProcesses,
        };
      }
      const discoveredLinks = discoverSearchLinks(page.html, page.url, connectorFamily);
      for (const link of discoveredLinks) {
        if (visited.has(link) || queue.includes(link)) continue;
        queue.push(link);
      }
      continue;
    }

    const sortedForms = forms
      .map((form) => ({ form, score: scoreFormForQuery(form, queryMode) }))
      .sort((a, b) => b.score - a.score)
      .map((item) => item.form);

    for (const form of sortedForms.slice(0, 3)) {
      const targetFields = pickTargetFields(form, queryMode);
      if (targetFields.length === 0) continue;

      const queryScopeVariants = (() => {
        const values = Array.from(
          new Set(
            form.inputs
              .filter((item) => item.type === "radio" && item.name === "opcaoConsultaPublica")
              .map((item) => String(item.value ?? "").trim())
              .filter(Boolean),
          ),
        ).slice(0, 3);
        if (values.length === 0) return [{}];
        return values.map((value) => ({ opcaoConsultaPublica: value }));
      })();

      for (const fieldOverrides of queryScopeVariants) {
        triedSubmission = true;
        const submit = await submitForm({
          form,
          timeoutMs: effectiveTimeoutMs,
          queryMode,
          queryValue: valid.value,
          session,
          refererUrl: page.url,
          fieldOverrides,
        });
        if (!submit.ok) {
          lastUnavailableReason = submit.reason;
          continue;
        }

        if (isCaptchaPage(submit.html)) observedCaptcha = true;
        if (isLoginPage(submit.html)) observedLogin = true;
        if (isAccessBlockedPage(submit.html, submit.status)) {
          return {
            connectorFamily,
            queryMode,
            status: "unavailable",
            statusReason: "access_blocked",
            latencyMs: Date.now() - startedAt,
            message: "Portal bloqueou o acesso da automação para consulta pública",
            evidence: [],
            processes: [],
          };
        }
        if (isPublicSearchDisabledPage(submit.html)) {
          return {
            connectorFamily,
            queryMode,
            status: "unavailable",
            statusReason: "public_query_disabled",
            latencyMs: Date.now() - startedAt,
            message: "Portal informa que a consulta pública está desativada",
            evidence: [],
            processes: [],
          };
        }

        const validationErrors = parseValidationErrors(submit.html);
        if (validationErrors.length > 0) {
          validationErrorsSeen.push(...validationErrors);
        }
        const processes = parseProcessesFromHtml(submit.html, tribunalId, submit.url);
        if (processes.length > 0) {
          return {
            connectorFamily,
            queryMode,
            status: "success",
            statusReason: "match_found",
            latencyMs: Date.now() - startedAt,
            message: `Consulta pública retornou ${processes.length} processo(s)`,
            evidence: [],
            processes,
          };
        }

        if (hasNoResultsMarker(submit.html) && validationErrors.length === 0) {
          return {
            connectorFamily,
            queryMode,
            status: "not_found",
            statusReason: "not_listed",
            latencyMs: Date.now() - startedAt,
            message: "Consulta concluída sem registros",
            evidence: [],
            processes: [],
          };
        }
      }
    }
  }

  if (validationErrorsSeen.length > 0) {
    return {
      connectorFamily,
      queryMode,
      status: "unavailable",
      statusReason: "form_validation_blocked",
      latencyMs: Date.now() - startedAt,
      message: `Formulário rejeitou a submissão: ${validationErrorsSeen[0]}`,
      evidence: [],
      processes: [],
    };
  }

  if (observedCaptcha) {
    return {
      connectorFamily,
      queryMode,
      status: "unavailable",
      statusReason: "captcha_blocked",
      latencyMs: Date.now() - startedAt,
      message: "Consulta pública bloqueada por captcha/validação humana",
      evidence: [],
      processes: [],
    };
  }

  if (triedSubmission) {
    return {
      connectorFamily,
      queryMode,
      status: "not_found",
      statusReason: "not_listed",
      latencyMs: Date.now() - startedAt,
      message: "Consulta executada sem retorno de processos para a entidade",
      evidence: [],
      processes: [],
    };
  }

  if (observedLogin) {
    return {
      connectorFamily,
      queryMode,
      status: "unavailable",
      statusReason: "login_required",
      latencyMs: Date.now() - startedAt,
      message: "Portal exige autenticação para pesquisar por entidade",
      evidence: [],
      processes: [],
    };
  }

  if (firstReachableHtml) {
    return {
      connectorFamily,
      queryMode,
      status: "unavailable",
      statusReason: "no_automatable_form",
      latencyMs: Date.now() - startedAt,
      message: "Página pública alcançada, porém sem formulário de busca automatizável",
      evidence: [],
      processes: [],
    };
  }

  return {
    connectorFamily,
    queryMode,
    status: "unavailable",
    statusReason: lastUnavailableReason || "timeout_or_network",
    latencyMs: Date.now() - startedAt,
    message: "Nenhum endpoint público respondeu de forma consultável",
    evidence: [],
    processes: [],
  };
}
