import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const OPENAI_BASE_URL = "https://api.openai.com/v1";

function getArg(name, fallback = "") {
  const prefix = `${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function listMarkdownFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const results = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await listMarkdownFiles(full);
      results.push(...nested);
      continue;
    }
    if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      results.push(full);
    }
  }
  results.sort();
  return results;
}

async function openaiRequest({ method, apiKey, pathname, jsonBody, formData }) {
  const headers = {
    Authorization: `Bearer ${apiKey}`,
  };

  let body;
  if (jsonBody) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(jsonBody);
  }
  if (formData) {
    body = formData;
  }

  const response = await fetch(`${OPENAI_BASE_URL}${pathname}`, {
    method,
    headers,
    body,
  });

  if (!response.ok) {
    const err = await response.text().catch(() => "");
    throw new Error(`OpenAI ${method} ${pathname} -> HTTP ${response.status}${err ? ` | ${err.slice(0, 300)}` : ""}`);
  }

  return response.json();
}

async function createVectorStore({ apiKey, name }) {
  return openaiRequest({
    method: "POST",
    apiKey,
    pathname: "/vector_stores",
    jsonBody: { name },
  });
}

async function uploadFile({ apiKey, filePath }) {
  const buffer = await readFile(filePath);
  const form = new FormData();
  form.append("purpose", "assistants");
  form.append("file", new Blob([buffer], { type: "text/markdown" }), path.basename(filePath));

  return openaiRequest({
    method: "POST",
    apiKey,
    pathname: "/files",
    formData: form,
  });
}

async function attachFileToVectorStore({ apiKey, vectorStoreId, fileId }) {
  return openaiRequest({
    method: "POST",
    apiKey,
    pathname: `/vector_stores/${vectorStoreId}/files`,
    jsonBody: { file_id: fileId },
  });
}

async function run() {
  const apiKey = String(process.env.OPENAI_API_KEY || "").trim();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY nao configurada.");
  }

  const ragDir = path.resolve(getArg("--rag-dir", "data/fte/rag"));
  const maxFiles = Number.parseInt(getArg("--max-files", "0"), 10);
  const dryRun = hasFlag("--dry-run");
  const createIfMissing = hasFlag("--create-vector-store");

  let vectorStoreId = String(getArg("--vector-store-id", process.env.OPENAI_VECTOR_STORE_ID || "")).trim();
  const vectorStoreName = String(getArg("--vector-store-name", "FTE Ambiental - Data Sweep")).trim();

  const files = await listMarkdownFiles(ragDir);
  const selected = maxFiles > 0 ? files.slice(0, maxFiles) : files;

  if (!vectorStoreId && createIfMissing && !dryRun) {
    const created = await createVectorStore({ apiKey, name: vectorStoreName });
    vectorStoreId = String(created?.id || "").trim();
  }

  if (!vectorStoreId && !dryRun) {
    throw new Error("Vector Store nao informado. Use --vector-store-id=<id> ou --create-vector-store.");
  }

  const results = [];
  let successCount = 0;

  for (let i = 0; i < selected.length; i += 1) {
    const filePath = selected[i];
    const relPath = path.relative(process.cwd(), filePath);

    if (dryRun) {
      results.push({ file: relPath, status: "dry_run" });
      continue;
    }

    try {
      const uploaded = await uploadFile({ apiKey, filePath });
      const fileId = String(uploaded?.id || "").trim();
      if (!fileId) throw new Error("upload sem file_id");

      const attached = await attachFileToVectorStore({
        apiKey,
        vectorStoreId,
        fileId,
      });

      results.push({
        file: relPath,
        file_id: fileId,
        vector_store_file_id: attached?.id || null,
        status: "ok",
      });
      successCount += 1;
    } catch (error) {
      results.push({
        file: relPath,
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      });
    }

    if ((i + 1) % 10 === 0 || i + 1 === selected.length) {
      console.log(`[fte-openai-filesearch] progresso: ${i + 1}/${selected.length}`);
    }

    await sleep(120);
  }

  const output = {
    generated_at: new Date().toISOString(),
    rag_dir: ragDir,
    vector_store_id: vectorStoreId || null,
    vector_store_name: vectorStoreName,
    dry_run: dryRun,
    total_files_discovered: files.length,
    total_files_processed: selected.length,
    total_success: successCount,
    results,
  };

  const outFile = path.resolve("data/fte/manifest/openai-filesearch-upload.json");
  await mkdir(path.dirname(outFile), { recursive: true });
  await writeFile(outFile, JSON.stringify(output, null, 2), "utf8");

  console.log("[fte-openai-filesearch] concluido");
  console.log(JSON.stringify({
    vector_store_id: output.vector_store_id,
    total_files_processed: output.total_files_processed,
    total_success: output.total_success,
    manifest: outFile,
  }, null, 2));
}

run().catch((error) => {
  console.error("[fte-openai-filesearch] erro fatal:", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
