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

function stripTags(value) {
  return decodeHtml(String(value ?? "").replace(/<[^>]+>/g, " "));
}

function isCaptchaPage(html) {
  const lower = String(html ?? "").toLowerCase();
  return (
    lower.includes("captcha") ||
    lower.includes("g-recaptcha") ||
    lower.includes("h-captcha") ||
    lower.includes("tencentcaptcha") ||
    lower.includes("sou humano") ||
    lower.includes("não sou robô") ||
    lower.includes("nao sou robo")
  );
}

function isLoginPage(html) {
  const lower = String(html ?? "").toLowerCase();
  const hasLoginWord = lower.includes("login") || lower.includes("entrar") || lower.includes("acesso");
  const hasPjeBrand = lower.includes("bem-vindo ao pje") || lower.includes("processo judicial eletrônico");
  return hasLoginWord && hasPjeBrand;
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
      inputs.push({ tag, name, value, type });
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
    if (input.type === "hidden") params.set(input.name, input.value ?? "");
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

async function fetchHtml(url, timeoutMs) {
  const response = await fetchWithTimeout(url, timeoutMs, { headers: DEFAULT_HEADERS });
  if (!response) return { ok: false, status: 0, reason: "timeout_or_network", url, html: "" };
  if (!response.ok) return { ok: false, status: response.status, reason: `http_${response.status}`, url: response.url ?? url, html: "" };
  const html = await response.text().catch(() => "");
  return {
    ok: true,
    status: response.status,
    reason: "ok",
    url: response.url ?? url,
    html,
  };
}

async function submitForm({ form, timeoutMs, queryMode, queryValue }) {
  const params = buildFormData(form, queryMode, queryValue);
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

  const response = await fetchWithTimeout(requestUrl, timeoutMs, {
    method,
    headers: {
      ...DEFAULT_HEADERS,
      ...(method === "POST" ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body,
  });
  if (!response) return { ok: false, reason: "timeout_or_network", html: "", status: 0, url: requestUrl };
  if (!response.ok) return { ok: false, reason: `http_${response.status}`, html: "", status: response.status, url: response.url ?? requestUrl };
  const html = await response.text().catch(() => "");
  return { ok: true, reason: "ok", html, status: response.status, url: response.url ?? requestUrl };
}

function buildPjeCandidates(tribunalId) {
  const hosts = new Set();
  hosts.add(`pje.${tribunalId}.jus.br`);
  hosts.add(`consultapublicapje.${tribunalId}.jus.br`);
  hosts.add(`pje-consulta-publica.${tribunalId}.jus.br`);
  hosts.add(`pje1g.${tribunalId}.jus.br`);
  hosts.add(`pje2g.${tribunalId}.jus.br`);
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
  return [
    `${base}/externo_controlador.php?acao=processo_consulta_publica`,
    `${base}/`,
  ];
}

function buildProjudiCandidates(tribunalId) {
  const host = tribunalId === "tjpr" ? "projudi.tjpr.jus.br" : `projudi.${tribunalId}.jus.br`;
  return [
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
  if (explicitBase) {
    return [explicitBase];
  }

  const tribunalId = String(tribunal?.tribunal_id ?? "").toLowerCase();
  if (!tribunalId) return [];
  if (connectorFamily === "pje") return buildPjeCandidates(tribunalId);
  if (connectorFamily === "eproc") return buildEprocCandidates(tribunalId);
  if (connectorFamily === "projudi") return buildProjudiCandidates(tribunalId);
  if (connectorFamily === "custom") return buildCustomCandidates(tribunalId);
  return [];
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

  const candidates = buildCandidateUrls(connectorFamily, tribunal).slice(0, 12);
  if (candidates.length === 0) {
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

  let firstReachableHtml = "";
  let reachableUrl = "";
  let lastUnavailableReason = "timeout_or_network";
  let triedSubmission = false;
  let observedCaptcha = false;
  let observedLogin = false;

  for (const candidate of candidates) {
    const page = await fetchHtml(candidate, timeoutMs);
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
      continue;
    }

    const sortedForms = forms
      .map((form) => ({ form, score: scoreFormForQuery(form, queryMode) }))
      .sort((a, b) => b.score - a.score)
      .map((item) => item.form);

    for (const form of sortedForms.slice(0, 3)) {
      const targetFields = pickTargetFields(form, queryMode);
      if (targetFields.length === 0) continue;

      triedSubmission = true;
      const submit = await submitForm({
        form,
        timeoutMs,
        queryMode,
        queryValue: valid.value,
      });
      if (!submit.ok) {
        lastUnavailableReason = submit.reason;
        continue;
      }

      if (isCaptchaPage(submit.html)) observedCaptcha = true;
      if (isLoginPage(submit.html)) observedLogin = true;
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

      if (/nenhum resultado|nenhum processo|não foram encontrados|nao foram encontrados/i.test(submit.html)) {
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
      status: "not_found",
      statusReason: "not_listed",
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

