import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const INDEX_URL =
  "https://www.gov.br/ibama/pt-br/servicos/cadastros/ctf/ctf-app/ftes/ftes-por-categorias";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

function getArg(name, fallback = "") {
  const prefix = `${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  if (!found) return fallback;
  return found.slice(prefix.length);
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeWhitespace(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtmlEntities(input) {
  const html = String(input ?? "");
  const named = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
    ndash: "-",
    mdash: "-",
    rsquo: "'",
    lsquo: "'",
    rdquo: '"',
    ldquo: '"',
    oacute: "ó",
    aacute: "á",
    eacute: "é",
    iacute: "í",
    uacute: "ú",
    ccedil: "ç",
    ordm: "º",
    ordf: "ª",
    sect: "§",
  };

  return html.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity) => {
    if (entity.startsWith("#x") || entity.startsWith("#X")) {
      const code = Number.parseInt(entity.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    if (entity.startsWith("#")) {
      const code = Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    const lower = entity.toLowerCase();
    return lower in named ? named[lower] : match;
  });
}

function htmlToText(html) {
  let text = String(html ?? "");
  text = text.replace(/<script[\s\S]*?<\/script>/gi, " ");
  text = text.replace(/<style[\s\S]*?<\/style>/gi, " ");
  text = text.replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");
  text = text.replace(/<\s*br\s*\/?\s*>/gi, "\n");
  text = text.replace(/<\/(p|div|li|tr|table|h1|h2|h3|h4|h5|h6|section|article)\s*>/gi, "\n");
  text = text.replace(/<[^>]+>/g, " ");
  text = decodeHtmlEntities(text);
  text = text.replace(/\r/g, "");
  text = text.replace(/[ \t]+\n/g, "\n");
  text = text.replace(/\n{3,}/g, "\n\n");
  text = text.replace(/[ \t]{2,}/g, " ");
  return text.trim();
}

function extractSection(html, startMarker, endMarker) {
  const start = html.indexOf(startMarker);
  if (start < 0) return "";
  const from = html.slice(start + startMarker.length);
  const end = from.indexOf(endMarker);
  if (end < 0) return from;
  return from.slice(0, end);
}

function extractLinksWithText(html, baseUrl) {
  const links = [];
  const re = /<a\b[^>]*href=("|')([^"']+)\1[^>]*>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = re.exec(html))) {
    const href = match[2];
    const rawText = htmlToText(match[3]);
    let absolute = "";
    try {
      absolute = new URL(href, baseUrl).href;
    } catch {
      continue;
    }
    links.push({ url: absolute, text: normalizeWhitespace(rawText) });
  }

  return links;
}

function shortHash(value) {
  return createHash("sha1").update(String(value)).digest("hex").slice(0, 10);
}

function sanitizeFileName(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

function getPageSlug(url) {
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split("/").filter(Boolean);
    const tail = parts[parts.length - 1] || shortHash(url);
    const clean = sanitizeFileName(tail);
    return clean.slice(0, 90) || shortHash(url);
  } catch {
    return shortHash(url);
  }
}

function parseSeiDocumentId(url) {
  try {
    const parsed = new URL(url);
    return parsed.searchParams.get("id_documento") || "";
  } catch {
    return "";
  }
}

async function fetchText(url, timeoutMs = 35000, retries = 2) {
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        headers: {
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "User-Agent": USER_AGENT,
        },
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return await response.text();
    } catch (error) {
      clearTimeout(timer);
      lastError = error;
      if (attempt < retries) {
        await sleep(500 * (attempt + 1));
      }
    }
  }

  throw new Error(`Falha ao baixar ${url}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

async function fileExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readTextIfExists(filePath) {
  if (!(await fileExists(filePath))) return "";
  return readFile(filePath, "utf8");
}

async function ensureDirs(paths) {
  for (const dir of paths) {
    await mkdir(dir, { recursive: true });
  }
}

async function run() {
  const outDir = path.resolve(getArg("--out-dir", "data/fte"));
  const maxPages = Number.parseInt(getArg("--max-pages", "0"), 10);
  const shouldDownloadSei = !hasFlag("--no-sei");
  const force = hasFlag("--force");

  const rawPagesDir = path.join(outDir, "raw", "fte-pages");
  const rawSeiDir = path.join(outDir, "raw", "sei-docs");
  const ragDir = path.join(outDir, "rag");
  const manifestDir = path.join(outDir, "manifest");

  await ensureDirs([rawPagesDir, rawSeiDir, ragDir, manifestDir]);

  console.log(`[fte-download] Index: ${INDEX_URL}`);
  const indexHtml = await fetchText(INDEX_URL);
  const indexFile = path.join(rawPagesDir, "index-ftes-por-categorias.html");
  await writeFile(indexFile, indexHtml, "utf8");

  const allLinks = extractLinksWithText(indexHtml, INDEX_URL).map((item) => item.url);
  const itemPages = [...new Set(allLinks)].filter(
    (url) =>
      url.startsWith("https://www.gov.br/ibama/") &&
      url.includes("/ftes/lista-de-todas-as-ftes/") &&
      !url.includes("#")
  );

  itemPages.sort();
  const selectedPages = maxPages > 0 ? itemPages.slice(0, maxPages) : itemPages;

  console.log(`[fte-download] FTE pages encontradas: ${itemPages.length} (processando ${selectedPages.length})`);

  const seiIndex = new Map();
  const pageManifest = [];
  let pageCount = 0;

  for (const pageUrl of selectedPages) {
    pageCount += 1;
    const slug = getPageSlug(pageUrl);
    const fileSlug = `${slug}-${shortHash(pageUrl)}`.slice(0, 120);
    const pageRawFile = path.join(rawPagesDir, `${fileSlug}.html`);

    let pageHtml = "";
    if (!force && (await fileExists(pageRawFile))) {
      pageHtml = await readFile(pageRawFile, "utf8");
    } else {
      pageHtml = await fetchText(pageUrl);
      await writeFile(pageRawFile, pageHtml, "utf8");
      await sleep(120);
    }

    const titleMatch = pageHtml.match(/<h1[^>]*class="documentFirstHeading"[^>]*>([\s\S]*?)<\/h1>/i);
    const title = normalizeWhitespace(htmlToText(titleMatch ? titleMatch[1] : "")) || `FTE ${fileSlug}`;

    const updatedMatch = pageHtml.match(/<span class="documentModified">[\s\S]*?<span class="value">([\s\S]*?)<\/span>/i);
    const updatedAt = normalizeWhitespace(htmlToText(updatedMatch ? updatedMatch[1] : ""));

    const coreHtml = extractSection(pageHtml, '<div id="content-core">', '<div id="viewlet-below-content-body">') || pageHtml;
    const coreText = htmlToText(coreHtml);

    const anchors = extractLinksWithText(coreHtml, pageUrl);
    const seiLinks = [...new Set(anchors.map((a) => a.url).filter((u) => u.startsWith("https://sei.ibama.gov.br/documento_consulta_externa.php")))];

    const seiItems = [];
    for (const seiUrl of seiLinks) {
      const docId = parseSeiDocumentId(seiUrl);
      const docKey = docId || shortHash(seiUrl);
      const seiFile = path.join(rawSeiDir, `${docKey}.html`);

      if (shouldDownloadSei && (force || !(await fileExists(seiFile)))) {
        try {
          const seiHtml = await fetchText(seiUrl);
          await writeFile(seiFile, seiHtml, "utf8");
          await sleep(100);
        } catch (error) {
          console.warn(`[fte-download] aviso: falha ao baixar SEI ${seiUrl} -> ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      if (!seiIndex.has(docKey)) {
        const seiText = await readTextIfExists(seiFile);
        const seiTitleMatch = seiText.match(/<title>([\s\S]*?)<\/title>/i);
        seiIndex.set(docKey, {
          key: docKey,
          id_documento: docId || null,
          url: seiUrl,
          title: normalizeWhitespace(htmlToText(seiTitleMatch ? seiTitleMatch[1] : "")) || null,
          file_path: path.relative(outDir, seiFile),
          downloaded: Boolean(seiText),
        });
      }

      const anchorMeta = anchors.find((a) => a.url === seiUrl);
      seiItems.push({
        key: docKey,
        id_documento: docId || null,
        url: seiUrl,
        anchor_text: anchorMeta?.text || "",
      });
    }

    let markdown = "";
    markdown += `# ${title}\n\n`;
    markdown += `- Fonte: ${pageUrl}\n`;
    if (updatedAt) markdown += `- Atualizado em: ${updatedAt}\n`;
    markdown += `- Links SEI relacionados: ${seiItems.length}\n\n`;
    markdown += "## Conteudo da FTE (pagina oficial)\n\n";
    markdown += `${coreText || "(sem texto extraido)"}\n\n`;

    if (seiItems.length > 0) {
      markdown += "## Documentos SEI relacionados\n\n";
      for (const item of seiItems) {
        const seiMeta = seiIndex.get(item.key);
        const seiRawPath = seiMeta ? path.join(outDir, seiMeta.file_path) : null;
        const seiHtml = seiRawPath ? await readTextIfExists(seiRawPath) : "";
        const seiText = seiHtml ? htmlToText(seiHtml) : "";
        const heading = item.id_documento ? `SEI ${item.id_documento}` : item.key;
        markdown += `### ${heading}\n\n`;
        markdown += `- URL: ${item.url}\n`;
        if (item.anchor_text) markdown += `- Link na tabela: ${item.anchor_text}\n`;
        if (seiMeta?.title) markdown += `- Titulo: ${seiMeta.title}\n`;
        markdown += "\n";
        markdown += seiText || "(nao foi possivel baixar este documento)";
        markdown += "\n\n";
      }
    }

    const ragFile = path.join(ragDir, `${fileSlug}.md`);
    await writeFile(ragFile, markdown, "utf8");

    pageManifest.push({
      slug: fileSlug,
      title,
      url: pageUrl,
      updated_at: updatedAt || null,
      raw_file: path.relative(outDir, pageRawFile),
      rag_file: path.relative(outDir, ragFile),
      sei_documents: seiItems,
    });

    if (pageCount % 10 === 0 || pageCount === selectedPages.length) {
      console.log(`[fte-download] progresso: ${pageCount}/${selectedPages.length}`);
    }
  }

  const seiManifest = [...seiIndex.values()].sort((a, b) => String(a.key).localeCompare(String(b.key)));
  const summary = {
    generated_at: new Date().toISOString(),
    index_url: INDEX_URL,
    total_pages_discovered: itemPages.length,
    total_pages_processed: pageManifest.length,
    total_sei_documents_discovered: seiManifest.length,
    output_dir: outDir,
    download_sei_enabled: shouldDownloadSei,
  };

  await writeFile(path.join(manifestDir, "fte-pages.json"), JSON.stringify(pageManifest, null, 2), "utf8");
  await writeFile(path.join(manifestDir, "sei-docs.json"), JSON.stringify(seiManifest, null, 2), "utf8");
  await writeFile(path.join(manifestDir, "summary.json"), JSON.stringify(summary, null, 2), "utf8");

  console.log("[fte-download] concluido");
  console.log(JSON.stringify(summary, null, 2));
}

run().catch((error) => {
  console.error("[fte-download] erro fatal:", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
