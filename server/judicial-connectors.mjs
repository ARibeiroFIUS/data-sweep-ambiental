import { cleanDocument, parseBooleanEnv, normalizePersonName } from "./common-utils.mjs";
import { fetchWithTimeout } from "./http-utils.mjs";
import { queryDatajudTribunal } from "./datajud-query.mjs";
import { runGenericTribunalConnector } from "./judicial-generic-connectors.mjs";
import { runBrowserTribunalConnector, shouldUseBrowserFallbackForTribunal } from "./judicial-browser-connectors.mjs";

const CONNECTOR_FEATURE_FLAGS = {
  datajud: "FEATURE_JUDICIAL_DATAJUD",
  pje: "FEATURE_JUDICIAL_PJE",
  esaj: "FEATURE_JUDICIAL_ESAJ",
  eproc: "FEATURE_JUDICIAL_EPROC",
  projudi: "FEATURE_JUDICIAL_PROJUDI",
  custom: "FEATURE_JUDICIAL_CUSTOM",
};

const DEFAULT_CONNECTOR_TIMEOUT_MS = Number.parseInt(process.env.JUDICIAL_CONNECTOR_TIMEOUT_MS ?? "12000", 10);
const ESAJ_MAX_PAGES = Number.parseInt(process.env.JUDICIAL_ESAJ_MAX_PAGES ?? "2", 10);
const ESAJ_DETAIL_LIMIT = Number.parseInt(process.env.JUDICIAL_ESAJ_DETAIL_LIMIT ?? "12", 10);
const ESAJ_ENTITY_VERIFICATION_LIMIT = Number.parseInt(process.env.JUDICIAL_ESAJ_ENTITY_VERIFICATION_LIMIT ?? "60", 10);
const ESAJ_DETAIL_CONCURRENCY = Number.parseInt(process.env.JUDICIAL_ESAJ_DETAIL_CONCURRENCY ?? "3", 10);
const ESAJ_FETCH_RETRIES = Number.parseInt(process.env.JUDICIAL_ESAJ_FETCH_RETRIES ?? "1", 10);
const ESAJ_FETCH_RETRY_DELAY_MS = Number.parseInt(process.env.JUDICIAL_ESAJ_FETCH_RETRY_DELAY_MS ?? "500", 10);
const DATAJUD_DISCOVERY_ENABLED = parseBooleanEnv(process.env.FEATURE_JUDICIAL_DATAJUD_DISCOVERY, false);
const JUDICIAL_BROWSER_FALLBACK_ENABLED = parseBooleanEnv(process.env.FEATURE_JUDICIAL_BROWSER_FALLBACK, true);

function isConnectorEnabled(connectorFamily) {
  const featureFlag = CONNECTOR_FEATURE_FLAGS[connectorFamily];
  if (!featureFlag) return true;
  return parseBooleanEnv(process.env[featureFlag], true);
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

function stripTags(value) {
  return decodeHtml(String(value ?? "").replace(/<[^>]+>/g, " "));
}

function parseBrazilianMoney(value) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  const normalized = text.replace(/[^\d.,-]/g, "");
  if (!normalized) return null;
  const numeric = Number(normalized.replace(/\./g, "").replace(",", "."));
  if (!Number.isFinite(numeric)) return null;
  return numeric;
}

function normalizeAlphaNum(value) {
  return normalizePersonName(String(value ?? ""))
    .replace(/[^A-Z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const ESAJ_ROLE_ACTIVE_REGEX =
  /\b(AUTOR|AUTORA|REQUERENTE|REQTE|EXEQUENTE|EXEQTE|IMPETRANTE|RECORRENTE|APELANTE|EMBARGANTE|AGRAVANTE|RECLAMANTE|CREDOR|PROMOVENTE|DEMANDANTE|QUERELANTE)\b/;
const ESAJ_ROLE_PASSIVE_REGEX =
  /\b(REU|RE|REQUERIDO|REQDO|EXECUTADO|EXECTDO|IMPETRADO|RECORRIDO|APELADO|EMBARGADO|AGRAVADO|RECLAMADO|DEVEDOR|PROMOVIDO|DEMANDADO|QUERELADO)\b/;

function mapEsajRoleToPolo(roleLabel) {
  const normalized = normalizeAlphaNum(roleLabel);
  if (!normalized) return null;
  if (ESAJ_ROLE_ACTIVE_REGEX.test(normalized)) return "ATIVO";
  if (ESAJ_ROLE_PASSIVE_REGEX.test(normalized)) return "PASSIVO";
  return null;
}

function nameOverlap(targetName, candidateName) {
  const target = normalizePersonName(targetName);
  const candidate = normalizePersonName(candidateName);
  if (!target || !candidate) return false;
  if (target === candidate) return true;
  if (target.length >= 8 && candidate.includes(target)) return true;
  if (candidate.length >= 8 && target.includes(candidate)) return true;
  return false;
}

function normalizeEsajDate(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const match = text.match(/(\d{2})\/(\d{2})\/(\d{4})(?:\s*(?:às)?\s*(\d{2}):(\d{2}))?/i);
  if (!match) return text;
  const dd = match[1];
  const mm = match[2];
  const yyyy = match[3];
  const hh = match[4];
  const min = match[5];
  if (hh && min) return `${yyyy}-${mm}-${dd}T${hh}:${min}:00`;
  return `${yyyy}-${mm}-${dd}`;
}

function hasCaptchaBlock(html) {
  const lower = String(html ?? "").toLowerCase();
  return (
    lower.includes("g-recaptcha") ||
    lower.includes("h-captcha") ||
    lower.includes("sou humano") ||
    lower.includes("digite os caracteres") ||
    lower.includes("validação captcha")
  );
}

function absoluteUrl(baseUrl, href) {
  try {
    if (!href) return baseUrl;
    return new URL(href, baseUrl).toString();
  } catch {
    return baseUrl;
  }
}

function parseCounter(html) {
  const match = String(html ?? "").match(/id="contadorDeProcessos"[^>]*>([\s\S]*?)<\/span>/i);
  if (!match) return null;
  const text = stripTags(match[1]);
  const numberMatch = text.match(/\d+/);
  if (!numberMatch) return null;
  const number = Number.parseInt(numberMatch[0], 10);
  return Number.isFinite(number) ? number : null;
}

function parseEsajListRows(html, baseUrl, tribunalId, grau) {
  const rows = [];
  const rowRegex = /<div class="row unj-ai-c home__lista-de-processos">([\s\S]*?)<\/li>/gi;

  let rowMatch;
  while ((rowMatch = rowRegex.exec(String(html ?? ""))) !== null) {
    const rowHtml = rowMatch[1];
    const linkMatch = rowHtml.match(/<a href="([^"]*show\.do[^"]*)" class="linkProcesso">([\s\S]*?)<\/a>/i);
    if (!linkMatch) continue;

    const numeroProcesso = stripTags(linkMatch[2]).replace(/\s+/g, " ").trim();
    if (!numeroProcesso) continue;

    const classeMatch = rowHtml.match(/<div class="classeProcesso">([\s\S]*?)<\/div>/i);
    const assuntoMatch = rowHtml.match(/<div class="assunto(?:Principal)?Processo">([\s\S]*?)<\/div>/i);
    const tipoPartMatch = rowHtml.match(/<label[^>]*class="[^"]*tipoDeParticipacao[^"]*"[^>]*>([\s\S]*?)<\/label>/i);
    const nomeParteMatch = rowHtml.match(/<div class="[^"]*(?:nomeParte|nomeParticipante)[^"]*">([\s\S]*?)<\/div>/i);

    const tipoParticipacao = stripTags(tipoPartMatch?.[1] ?? "").replace(/:$/, "").trim();
    const nomeParte = stripTags(nomeParteMatch?.[1] ?? "").trim();

    rows.push({
      tribunal: tribunalId,
      numeroProcesso,
      classe: { nome: stripTags(classeMatch?.[1] ?? "") || null },
      assuntos: (() => {
        const assunto = stripTags(assuntoMatch?.[1] ?? "");
        return assunto ? [{ nome: assunto }] : [];
      })(),
      dataAjuizamento: null,
      ano: null,
      orgaoJulgador: null,
      valor: null,
      grau,
      polo: mapEsajRoleToPolo(tipoParticipacao),
      parteContraria: [],
      andamentos: [],
      tipoParticipacao: tipoParticipacao || null,
      matchedPartyName: nomeParte || null,
      sourceUrl: absoluteUrl(baseUrl, linkMatch[1]),
    });
  }

  return rows;
}

function parseEsajShowPage(html, tribunalId, grau, sourceUrl) {
  const numero = stripTags(String(html).match(/id="numeroProcesso"[^>]*>([\s\S]*?)<\/span>/i)?.[1] ?? "");
  if (!numero) return null;

  const classe = stripTags(String(html).match(/id="classeProcesso"[^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? "");
  const assunto = stripTags(String(html).match(/id="assuntoProcesso"[^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? "");

  return {
    tribunal: tribunalId,
    numeroProcesso: numero,
    classe: { nome: classe || null },
    assuntos: assunto ? [{ nome: assunto }] : [],
    dataAjuizamento: null,
    ano: null,
    orgaoJulgador: null,
    valor: null,
    grau,
    polo: null,
    parteContraria: [],
    andamentos: [],
    sourceUrl,
  };
}

function parseEsajPartesFromShow(html) {
  const page = String(html ?? "");
  const tableMatch =
    page.match(/<table[^>]*id="tablePartesPrincipais"[^>]*>([\s\S]*?)<\/table>/i) ??
    page.match(/<table[^>]*id="tableTodasPartes"[^>]*>([\s\S]*?)<\/table>/i);

  if (!tableMatch) return [];

  const tableHtml = tableMatch[1];
  const rows = [];
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;
  while ((rowMatch = rowRegex.exec(tableHtml)) !== null) {
    const row = rowMatch[1];
    const roleRaw = stripTags(row.match(/class="[^"]*tipoDeParticipacao[^"]*"[^>]*>([\s\S]*?)<\/span>/i)?.[1] ?? "");
    const nameCell = row.match(/class="nomeParteEAdvogado"[^>]*>([\s\S]*?)<\/td>/i)?.[1] ?? "";
    const firstLine = String(nameCell).split(/<br\s*\/?>/i)[0] ?? "";
    const name = stripTags(firstLine).trim();
    if (!name) continue;
    rows.push({
      nome: name,
      roleLabel: roleRaw || null,
      polo: mapEsajRoleToPolo(roleRaw),
    });
  }
  return rows;
}

function deriveEsajPoloAndCounterparties(partes, targetNames) {
  if (!Array.isArray(partes) || partes.length === 0) {
    return { polo: null, parteContraria: [], targetEntityMatched: false, targetEntityNamesMatched: [] };
  }
  const normalizedTargets = (Array.isArray(targetNames) ? targetNames : [])
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);
  if (normalizedTargets.length === 0) {
    return { polo: null, parteContraria: [], targetEntityMatched: false, targetEntityNamesMatched: [] };
  }

  const matched = partes.filter((parte) => normalizedTargets.some((target) => nameOverlap(target, parte?.nome)));
  const matchedNames = Array.from(
    new Set(
      matched
        .map((parte) => String(parte?.nome ?? "").trim())
        .filter(Boolean),
    ),
  );
  if (matched.length === 0) {
    return { polo: null, parteContraria: [], targetEntityMatched: false, targetEntityNamesMatched: [] };
  }

  const activeMatches = matched.filter((item) => item.polo === "ATIVO").length;
  const passiveMatches = matched.filter((item) => item.polo === "PASSIVO").length;
  let polo = null;
  if (activeMatches > passiveMatches) polo = "ATIVO";
  if (passiveMatches > activeMatches) polo = "PASSIVO";
  if (!polo) return { polo: null, parteContraria: [], targetEntityMatched: true, targetEntityNamesMatched: matchedNames };

  const opposite = polo === "ATIVO" ? "PASSIVO" : "ATIVO";
  const counterparties = partes
    .filter((item) => item.polo === opposite)
    .map((item) => String(item.nome ?? "").trim())
    .filter(Boolean)
    .slice(0, 5);

  return { polo, parteContraria: counterparties, targetEntityMatched: true, targetEntityNamesMatched: matchedNames };
}

function parseEsajShowDetails(html, { targetNames = [] } = {}) {
  const classe = stripTags(String(html).match(/id="classeProcesso"[^>]*>([\s\S]*?)<\/span>/i)?.[1] ?? "");
  const assunto = stripTags(String(html).match(/id="assuntoProcesso"[^>]*>([\s\S]*?)<\/span>/i)?.[1] ?? "");
  const foro = stripTags(String(html).match(/id="foroProcesso"[^>]*>([\s\S]*?)<\/span>/i)?.[1] ?? "");
  const vara = stripTags(String(html).match(/id="varaProcesso"[^>]*>([\s\S]*?)<\/span>/i)?.[1] ?? "");
  const dataDistribuicaoRaw = stripTags(
    String(html).match(/id="dataHoraDistribuicaoProcesso"[^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? "",
  );
  const valorRaw = stripTags(String(html).match(/id="valorAcaoProcesso"[^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? "");

  const andamentos = [];
  const rowRegex = /<tr[^>]*class="[^"]*containerMovimentacao[^"]*"[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;
  while ((rowMatch = rowRegex.exec(String(html ?? ""))) !== null) {
    const row = rowMatch[1];
    const data = stripTags(row.match(/<td[^>]*class="[^"]*dataMovimentacao[^"]*"[^>]*>([\s\S]*?)<\/td>/i)?.[1] ?? "");
    const descricao = stripTags(
      row.match(/<td[^>]*class="[^"]*descricaoMovimentacao[^"]*"[^>]*>([\s\S]*?)<\/td>/i)?.[1] ?? "",
    );
    if (!descricao) continue;
    andamentos.push({
      dataHora: normalizeEsajDate(data),
      nome: descricao,
      complemento: null,
    });
    if (andamentos.length >= 5) break;
  }

  const partes = parseEsajPartesFromShow(html);
  const role = deriveEsajPoloAndCounterparties(partes, targetNames);

  const orgao = [vara, foro].filter(Boolean).join(" - ");
  return {
    classe: classe ? { nome: classe } : null,
    assuntos: assunto ? [{ nome: assunto }] : [],
    dataAjuizamento: normalizeEsajDate(dataDistribuicaoRaw),
    orgaoJulgador: orgao ? { nome: orgao } : null,
    valor: parseBrazilianMoney(valorRaw),
    andamentos,
    polo: role.polo,
    parteContraria: role.parteContraria,
    targetEntityMatched: role.targetEntityMatched,
    targetEntityNamesMatched: role.targetEntityNamesMatched,
  };
}

function dedupeProcesses(processes) {
  const byKey = new Map();
  for (const process of processes) {
    const key = `${process.tribunal}:${process.numeroProcesso}`;
    if (!byKey.has(key)) {
      byKey.set(key, process);
      continue;
    }
    const current = byKey.get(key);
    if (!current) {
      byKey.set(key, process);
      continue;
    }
    byKey.set(key, {
      ...current,
      ...process,
      classe: current.classe?.nome ? current.classe : process.classe,
      assuntos:
        Array.isArray(current.assuntos) && current.assuntos.length > 0 ? current.assuntos : process.assuntos,
      dataAjuizamento: current.dataAjuizamento ?? process.dataAjuizamento,
      ano: current.ano ?? process.ano,
      orgaoJulgador: current.orgaoJulgador ?? process.orgaoJulgador,
      valor: current.valor ?? process.valor,
      polo: current.polo ?? process.polo ?? null,
      parteContraria:
        Array.isArray(current.parteContraria) && current.parteContraria.length > 0
          ? current.parteContraria
          : process.parteContraria ?? [],
      andamentos:
        Array.isArray(current.andamentos) && current.andamentos.length > 0 ? current.andamentos : process.andamentos ?? [],
      sourceUrl: current.sourceUrl ?? process.sourceUrl ?? null,
      matchedPartyName: current.matchedPartyName ?? process.matchedPartyName ?? null,
      targetEntityMatched: Boolean(current.targetEntityMatched) || Boolean(process.targetEntityMatched),
      targetEntityNamesMatched:
        Array.isArray(current.targetEntityNamesMatched) && current.targetEntityNamesMatched.length > 0
          ? current.targetEntityNamesMatched
          : Array.isArray(process.targetEntityNamesMatched)
            ? process.targetEntityNamesMatched
            : [],
    });
  }
  return Array.from(byKey.values());
}

function filterEsajProcessesByTargetEntity(processes, targetNameHints, strictByDetail = false) {
  const normalizedTargets = (Array.isArray(targetNameHints) ? targetNameHints : [])
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);

  if (normalizedTargets.length === 0) {
    return { processes, dropped: 0 };
  }

  const kept = [];
  let dropped = 0;
  for (const process of Array.isArray(processes) ? processes : []) {
    const matchedByDetail = Boolean(process?.targetEntityMatched);
    const matchedByList =
      !strictByDetail && normalizedTargets.some((target) => nameOverlap(target, process?.matchedPartyName));
    if (matchedByDetail || matchedByList) {
      kept.push(process);
    } else {
      dropped += 1;
    }
  }
  return { processes: kept, dropped };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function enrichEsajProcessesWithShowDetails(processes, timeoutMs, targetNameHints = [], maxCandidates = ESAJ_DETAIL_LIMIT) {
  if (!Array.isArray(processes) || processes.length === 0) {
    return { processes: [], summary: { attempted: 0, enriched: 0, failed: 0 } };
  }

  const candidates = processes
    .filter((item) => String(item?.sourceUrl ?? "").includes("/show.do"))
    .slice(0, Math.max(1, maxCandidates));

  if (candidates.length === 0) {
    return { processes, summary: { attempted: 0, enriched: 0, failed: 0 } };
  }

  let index = 0;
  let enriched = 0;
  let failed = 0;
  const mergedByKey = new Map(processes.map((item) => [`${item.tribunal}:${item.numeroProcesso}`, item]));

  async function worker() {
    while (index < candidates.length) {
      const current = candidates[index];
      index += 1;
      const key = `${current.tribunal}:${current.numeroProcesso}`;
      const target = mergedByKey.get(key);
      if (!target) continue;

      const detailResp = await fetchEsajPage(current.sourceUrl, timeoutMs);
      if (!detailResp.ok || hasCaptchaBlock(detailResp.html)) {
        failed += 1;
        continue;
      }

      const detail = parseEsajShowDetails(detailResp.html, {
        targetNames: [...targetNameHints, current.matchedPartyName].filter(Boolean),
      });
      mergedByKey.set(key, {
        ...target,
        classe: target.classe?.nome ? target.classe : detail.classe,
        assuntos: Array.isArray(target.assuntos) && target.assuntos.length > 0 ? target.assuntos : detail.assuntos,
        dataAjuizamento: target.dataAjuizamento ?? detail.dataAjuizamento,
        ano: target.ano ?? (detail.dataAjuizamento ? String(detail.dataAjuizamento).slice(0, 4) : null),
        orgaoJulgador: target.orgaoJulgador ?? detail.orgaoJulgador,
        valor: target.valor ?? detail.valor ?? null,
        polo: detail.polo ?? target.polo ?? null,
        parteContraria:
          Array.isArray(detail.parteContraria) && detail.parteContraria.length > 0
            ? detail.parteContraria
            : Array.isArray(target.parteContraria)
              ? target.parteContraria
              : [],
        andamentos: Array.isArray(target.andamentos) && target.andamentos.length > 0 ? target.andamentos : detail.andamentos,
      });
      enriched += 1;
    }
  }

  const workers = Array.from({ length: Math.max(1, ESAJ_DETAIL_CONCURRENCY) }, () => worker());
  await Promise.all(workers);

  return {
    processes: Array.from(mergedByKey.values()),
    summary: { attempted: candidates.length, enriched, failed },
  };
}

function buildEsajSearchQuery({ scope, mode, value, page = 1 }) {
  if (scope === "cpopg") {
    const base = {
      conversationId: "",
      cbPesquisa: mode,
      "dadosConsulta.tipoNuProcesso": "UNIFICADO",
      "dadosConsulta.valorConsulta": value,
      cdForo: "-1",
      uuidCaptcha: "",
    };
    if (page > 1) base.paginaConsulta = String(page);
    return base;
  }

  const base = {
    conversationId: "",
    "dadosConsulta.localPesquisa.cdLocal": "-1",
    cbPesquisa: mode,
    "dadosConsulta.tipoNuProcesso": "UNIFICADO",
    dePesquisa: value,
    uuidCaptcha: "",
  };
  if (page > 1) base.paginaConsulta = String(page);
  return base;
}

function buildEsajBaseUrl(tribunal) {
  const explicit = String(tribunal?.config_json?.base_url ?? "").trim();
  if (explicit) return explicit.replace(/\/$/, "");

  const id = String(tribunal?.tribunal_id ?? "").toLowerCase();
  if (!id) return "";
  return `https://esaj.${id}.jus.br`;
}

async function fetchEsajPage(url, timeoutMs) {
  const retries = Math.max(0, ESAJ_FETCH_RETRIES);
  let lastFailure = { ok: false, reason: "timeout_or_network", html: "" };

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const response = await fetchWithTimeout(url, timeoutMs, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; data-sweep-engine/1.0; +https://railway.app)",
        accept: "text/html,application/xhtml+xml",
      },
    });

    if (!response) {
      lastFailure = { ok: false, reason: "timeout_or_network", html: "" };
    } else if (response.status === 401 || response.status === 403) {
      return { ok: false, reason: "unauthorized", html: "" };
    } else if (response.status === 429) {
      lastFailure = { ok: false, reason: "rate_limited", html: "" };
    } else if (!response.ok) {
      lastFailure = { ok: false, reason: `http_${response.status}`, html: "" };
    } else {
      const html = await response.text().catch(() => "");
      return { ok: true, reason: "ok", html };
    }

    const shouldRetry =
      lastFailure.reason === "timeout_or_network" ||
      lastFailure.reason === "rate_limited" ||
      lastFailure.reason === "http_503" ||
      lastFailure.reason === "http_504";

    if (attempt < retries && shouldRetry) {
      await sleep(ESAJ_FETCH_RETRY_DELAY_MS * (attempt + 1));
      continue;
    }
    break;
  }

  return lastFailure;
}

async function crawlEsajScope({
  tribunal,
  queryMode,
  value,
  scope,
  timeoutMs,
}) {
  const tribunalId = String(tribunal?.tribunal_id ?? "").toLowerCase();
  const baseUrl = buildEsajBaseUrl(tribunal);
  if (!baseUrl) {
    return {
      status: "unavailable",
      statusReason: "invalid_tribunal",
      processes: [],
      message: "Base URL do tribunal ESAJ não configurada",
    };
  }

  const mode = queryMode === "cnpj_exact" ? "DOCPARTE" : queryMode === "party_name" ? "NMPARTE" : null;
  if (!mode) {
    return {
      status: "unavailable",
      statusReason: "unsupported_query_mode",
      processes: [],
      message: `Modo ${queryMode} não suportado em ${scope}`,
    };
  }

  const searchPath = scope === "cpopg" ? "/cpopg/search.do" : "/cposg/search.do";
  const pagePath = scope === "cpopg" ? "/cpopg/trocarPagina.do" : "/cposg/trocarPagina.do";

  const firstQuery = buildEsajSearchQuery({ scope, mode, value, page: 1 });
  const firstUrl = new URL(searchPath, baseUrl);
  Object.entries(firstQuery).forEach(([key, queryValue]) => firstUrl.searchParams.set(key, queryValue));

  const first = await fetchEsajPage(firstUrl.toString(), timeoutMs);
  if (!first.ok) {
    return {
      status: "unavailable",
      statusReason: first.reason,
      processes: [],
      message: `${scope.toUpperCase()} indisponível (${first.reason})`,
    };
  }

  if (hasCaptchaBlock(first.html)) {
    return {
      status: "unavailable",
      statusReason: "captcha_blocked",
      processes: [],
      message: `${scope.toUpperCase()} bloqueou consulta por captcha`,
    };
  }

  const grau = scope === "cpopg" ? "G1" : "G2";
  let processes = parseEsajListRows(first.html, baseUrl, tribunalId, grau);

  if (processes.length === 0) {
    const show = parseEsajShowPage(first.html, tribunalId, grau, firstUrl.toString());
    if (show) processes.push(show);
  }

  const total = parseCounter(first.html) ?? processes.length;
  const maxPages = Math.max(1, Math.min(ESAJ_MAX_PAGES, Math.ceil(total / 25)));

  if (maxPages > 1) {
    for (let page = 2; page <= maxPages; page += 1) {
      const pageQuery = buildEsajSearchQuery({ scope, mode, value, page });
      const pageUrl = new URL(pagePath, baseUrl);
      Object.entries(pageQuery).forEach(([key, queryValue]) => pageUrl.searchParams.set(key, queryValue));
      const pageResp = await fetchEsajPage(pageUrl.toString(), timeoutMs);
      if (!pageResp.ok || hasCaptchaBlock(pageResp.html)) continue;
      processes.push(...parseEsajListRows(pageResp.html, baseUrl, tribunalId, grau));
    }
  }

  const unique = dedupeProcesses(processes);
  return {
    status: unique.length > 0 ? "success" : "not_found",
    statusReason: unique.length > 0 ? "match_found" : "not_listed",
    processes: unique,
    message:
      unique.length > 0
        ? `${scope.toUpperCase()} retornou ${unique.length} processo(s)`
        : `${scope.toUpperCase()} sem registros para consulta`,
  };
}

async function runEsajConnector({ tribunal, queryMode, document, name, timeoutMs }) {
  const startedAt = Date.now();
  const queryValue = queryMode === "cnpj_exact" ? cleanDocument(document) : String(name ?? "").trim();

  if (queryMode === "cnpj_exact" && queryValue.length !== 14) {
    return {
      connectorFamily: "esaj",
      queryMode,
      status: "invalid",
      statusReason: "invalid_cnpj",
      latencyMs: Date.now() - startedAt,
      message: "CNPJ inválido para crawler ESAJ",
      evidence: [],
      processes: [],
    };
  }

  if (queryMode === "party_name" && normalizePersonName(queryValue).split(" ").filter(Boolean).length < 2) {
    return {
      connectorFamily: "esaj",
      queryMode,
      status: "invalid",
      statusReason: "invalid_party_name",
      latencyMs: Date.now() - startedAt,
      message: "Nome insuficiente para crawler ESAJ",
      evidence: [],
      processes: [],
    };
  }

  const [cpopg, cposg] = await Promise.all([
    crawlEsajScope({ tribunal, queryMode, value: queryValue, scope: "cpopg", timeoutMs }),
    crawlEsajScope({ tribunal, queryMode, value: queryValue, scope: "cposg", timeoutMs }),
  ]);

  let combined = dedupeProcesses([...(cpopg.processes ?? []), ...(cposg.processes ?? [])]);
  const targetNameHints = [queryMode === "party_name" ? queryValue : String(name ?? "").trim()].filter(Boolean);
  const strictEntityVerification = queryMode === "cnpj_exact";
  const detailLimit = strictEntityVerification
    ? Math.max(ESAJ_DETAIL_LIMIT, ESAJ_ENTITY_VERIFICATION_LIMIT)
    : ESAJ_DETAIL_LIMIT;
  let detailSummary = { attempted: 0, enriched: 0, failed: 0 };
  let droppedByTargetFilter = 0;
  if (combined.length > 0) {
    const detailResult = await enrichEsajProcessesWithShowDetails(
      combined,
      timeoutMs,
      targetNameHints,
      detailLimit,
    );
    combined = detailResult.processes;
    detailSummary = detailResult.summary;
    const filtered = filterEsajProcessesByTargetEntity(combined, targetNameHints, strictEntityVerification);
    combined = filtered.processes;
    droppedByTargetFilter = filtered.dropped;
  }

  let status = "not_found";
  let statusReason = "not_listed";
  if (combined.length > 0) {
    status = "success";
    statusReason = "match_found";
  } else {
    const statuses = [cpopg.status, cposg.status];
    const reasons = [cpopg.statusReason, cposg.statusReason].filter(Boolean);
    if (statuses.every((item) => item === "unavailable" || item === "error")) {
      status = "unavailable";
      statusReason = reasons[0] ?? "no_tribunal_response";
    } else if (statuses.includes("unavailable") || statuses.includes("error")) {
      status = "not_found";
      statusReason = "partial_coverage_no_match";
    }
  }

  const detailSuffix =
    detailSummary.attempted > 0
      ? `; Detalhamento ESAJ: ${detailSummary.enriched}/${detailSummary.attempted}`
      : "";
  const targetFilterSuffix =
    droppedByTargetFilter > 0
      ? `; Filtro parte-alvo removeu ${droppedByTargetFilter} resultado(s) sem confirmação da empresa como parte`
      : "";
  const message = `CPoPG: ${cpopg.message}; CPoSG: ${cposg.message}${detailSuffix}${targetFilterSuffix}`;
  return {
    connectorFamily: "esaj",
    queryMode,
    status,
    statusReason,
    latencyMs: Date.now() - startedAt,
    message,
    evidence: [],
    processes: combined,
  };
}

async function runDatajudConnector({ tribunalId, queryMode, document, name, timeoutMs }) {
  return queryDatajudTribunal({
    tribunalId,
    queryMode,
    cnpj: document,
    name,
    timeoutMs,
  });
}

function baseResult({ connectorFamily, queryMode, startedAt, status, statusReason, message, processes = [] }) {
  return {
    connectorFamily,
    queryMode,
    status,
    statusReason,
    latencyMs: Date.now() - startedAt,
    message,
    evidence: [],
    processes,
  };
}

async function runPlaceholderConnector({ connectorFamily, queryMode }) {
  const startedAt = Date.now();
  return baseResult({
    connectorFamily,
    queryMode,
    startedAt,
    status: "unavailable",
    statusReason: "unsupported_query_mode",
    message: `Conector ${connectorFamily.toUpperCase()} em implementação para consultas por entidade`,
  });
}

async function runFamilyConnector({ connectorFamily, tribunal, tribunalId, queryMode, document, name, runId, timeoutMs }) {
  if (!isConnectorEnabled(connectorFamily)) {
    return {
      connectorFamily,
      queryMode,
      status: "unavailable",
      statusReason: "feature_disabled",
      latencyMs: 0,
      message: `Conector ${connectorFamily} desabilitado por feature flag`,
      evidence: [],
      processes: [],
    };
  }

  if (connectorFamily === "datajud") {
    if (!DATAJUD_DISCOVERY_ENABLED && (queryMode === "cnpj_exact" || queryMode === "party_name")) {
      return {
        connectorFamily,
        queryMode,
        status: "unavailable",
        statusReason: "deferred_datajud_enrichment",
        latencyMs: 0,
        message: "DataJud reservado para enriquecimento após descoberta por crawler",
        evidence: [],
        processes: [],
      };
    }

    return runDatajudConnector({ tribunalId, queryMode, document, name, runId, timeoutMs });
  }

  if (connectorFamily === "esaj") {
    return runEsajConnector({ tribunal, queryMode, document, name, timeoutMs });
  }

  if (
    connectorFamily === "pje" ||
    connectorFamily === "eproc" ||
    connectorFamily === "projudi" ||
    connectorFamily === "custom"
  ) {
    const genericResult = await runGenericTribunalConnector({
      connectorFamily,
      tribunal,
      queryMode,
      document,
      name,
      timeoutMs,
    });

    const browserFallbackEligible =
      JUDICIAL_BROWSER_FALLBACK_ENABLED &&
      connectorFamily === "pje" &&
      shouldUseBrowserFallbackForTribunal(tribunalId) &&
      (queryMode === "cnpj_exact" || queryMode === "party_name") &&
      (genericResult.status === "unavailable" ||
        genericResult.statusReason === "no_automatable_form" ||
        genericResult.statusReason === "timeout_or_network");

    if (!browserFallbackEligible) {
      return genericResult;
    }

    const browserResult = await runBrowserTribunalConnector({
      connectorFamily,
      tribunal,
      queryMode,
      document,
      name,
      timeoutMs: Math.max(timeoutMs, 15000),
    });

    if (browserResult.status === "success" || browserResult.status === "not_found") {
      return {
        ...browserResult,
        message: `${browserResult.message} (fallback browser-first)`,
      };
    }

    return {
      ...genericResult,
      message: `${genericResult.message}; browser-first: ${browserResult.message}`,
    };
  }

  return runPlaceholderConnector({ connectorFamily, queryMode });
}

/**
 * Contrato único para consulta judicial por tribunal.
 * @param {{
 *  tribunal: Record<string, any>,
 *  queryMode: string,
 *  document?: string,
 *  name?: string,
 *  runId?: string,
 *  timeoutMs?: number,
 * }} input
 */
export async function runJudicialConnectorQuery(input) {
  const tribunal = input?.tribunal ?? {};
  const tribunalId = String(tribunal.tribunal_id ?? "").toLowerCase();
  const queryMode = String(input?.queryMode ?? "cnpj_exact").trim();
  const cleanDoc = cleanDocument(input?.document ?? "");
  const configTimeout = Number(
    tribunal?.config_json?.timeoutMs ?? tribunal?.config_json?.timeout_ms ?? Number.NaN,
  );
  const timeoutMs = Number.isFinite(Number(input?.timeoutMs))
    ? Number(input.timeoutMs)
    : Number.isFinite(configTimeout) && configTimeout > 0
      ? configTimeout
      : DEFAULT_CONNECTOR_TIMEOUT_MS;

  const primaryFamily = String(tribunal.connector_family ?? "datajud").toLowerCase();
  const fallbackFamilies = Array.isArray(tribunal?.config_json?.fallbackFamilies)
    ? tribunal.config_json.fallbackFamilies.map((value) => String(value).toLowerCase())
    : [];
  const families = [primaryFamily, ...fallbackFamilies.filter((family) => family !== primaryFamily)];

  const attempts = [];
  for (let index = 0; index < families.length; index += 1) {
    const family = families[index];
    const nextFamily = families[index + 1] ?? null;
    const result = await runFamilyConnector({
      connectorFamily: family,
      tribunal,
      tribunalId,
      queryMode,
      document: cleanDoc,
      name: input?.name,
      runId: input?.runId,
      timeoutMs,
    });

    attempts.push({
      connector_family: family,
      status: result.status,
      status_reason: result.statusReason,
      latency_ms: result.latencyMs,
      message: result.message,
    });

    const terminal = result.status === "success" || result.status === "not_found";
    if (terminal) {
      return {
        ...result,
        attempts,
      };
    }

    const blockEntityFallbackToDatajud =
      (queryMode === "cnpj_exact" || queryMode === "party_name") &&
      family !== "datajud" &&
      nextFamily === "datajud";
    if (blockEntityFallbackToDatajud) {
      return {
        ...result,
        attempts,
      };
    }

    const shouldTryFallback =
      result.status === "unavailable" ||
      result.status === "error" ||
      result.statusReason === "unsupported_query_mode" ||
      result.statusReason === "entity_lookup_not_supported_public_api" ||
      result.statusReason === "feature_disabled";

    if (!shouldTryFallback) {
      return {
        ...result,
        attempts,
      };
    }
  }

  return {
    connectorFamily: primaryFamily,
    queryMode,
    status: "unavailable",
    statusReason: "no_tribunal_response",
    latencyMs: attempts.reduce((sum, item) => sum + Number(item.latency_ms ?? 0), 0),
    message: `Nenhum conector retornou resposta consultável para ${tribunalId}`,
    evidence: [],
    processes: [],
    attempts,
  };
}
