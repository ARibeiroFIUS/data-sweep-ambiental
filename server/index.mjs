import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeCnpj, HttpError } from "./analyze-cnpj.mjs";
import { runPgfnSyncJob } from "./pgfn-sync.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const distDir = path.join(projectRoot, "dist");
const port = Number.parseInt(process.env.PORT ?? "3000", 10);
const JOB_ADMIN_TOKEN = (process.env.JOB_ADMIN_TOKEN ?? "").trim();
let pgfnSyncInFlight = null;

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function setApiCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-job-token");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(body);
}

async function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";

    req.on("data", (chunk) => {
      body += chunk.toString("utf-8");
      if (body.length > 1_000_000) {
        reject(new HttpError(413, "Payload muito grande"));
      }
    });

    req.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new HttpError(400, "JSON inválido"));
      }
    });

    req.on("error", () => reject(new HttpError(400, "Falha ao ler request")));
  });
}

async function serveStatic(req, res, pathname) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    sendJson(res, 405, { error: "Método não permitido" });
    return;
  }

  let requestedPath = pathname === "/" ? "/index.html" : pathname;
  if (requestedPath.includes("\0")) {
    sendJson(res, 400, { error: "Path inválido" });
    return;
  }

  let filePath = path.normalize(path.join(distDir, requestedPath));
  if (!filePath.startsWith(distDir)) {
    sendJson(res, 403, { error: "Acesso negado" });
    return;
  }

  try {
    let stat = await fs.stat(filePath);
    if (stat.isDirectory()) {
      filePath = path.join(filePath, "index.html");
      stat = await fs.stat(filePath);
    }

    const ext = path.extname(filePath);
    const contentType = MIME_TYPES[ext] ?? "application/octet-stream";
    const content = await fs.readFile(filePath);
    res.writeHead(200, { "Content-Type": contentType, "Content-Length": stat.size });
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    res.end(content);
    return;
  } catch {
    try {
      const indexPath = path.join(distDir, "index.html");
      const indexContent = await fs.readFile(indexPath);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      if (req.method === "HEAD") {
        res.end();
        return;
      }
      res.end(indexContent);
      return;
    } catch {
      sendJson(res, 500, { error: "Build do frontend não encontrado. Rode `npm run build`." });
      return;
    }
  }
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const { pathname } = requestUrl;

  if (pathname === "/health") {
    sendJson(res, 200, { status: "ok" });
    return;
  }

  if (pathname === "/api/analyze-cnpj") {
    setApiCorsHeaders(res);

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method !== "POST") {
      sendJson(res, 405, { error: "Método não permitido" });
      return;
    }

    try {
      const body = await readJsonBody(req);
      const cnpj = typeof body === "object" && body !== null && "cnpj" in body ? body.cnpj : "";
      const result = await analyzeCnpj(String(cnpj ?? ""));
      sendJson(res, 200, result);
    } catch (error) {
      if (error instanceof HttpError) {
        sendJson(res, error.statusCode, { error: error.message });
        return;
      }

      console.error("Unhandled API error:", error);
      sendJson(res, 500, { error: "Erro interno ao processar a consulta" });
    }
    return;
  }

  if (pathname === "/api/jobs/sync-pgfn") {
    setApiCorsHeaders(res);

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method !== "POST") {
      sendJson(res, 405, { error: "Método não permitido" });
      return;
    }

    if (!JOB_ADMIN_TOKEN) {
      sendJson(res, 503, { error: "JOB_ADMIN_TOKEN não configurado no ambiente" });
      return;
    }

    const authHeader = String(req.headers["x-job-token"] ?? "");
    if (authHeader !== JOB_ADMIN_TOKEN) {
      sendJson(res, 401, { error: "Não autorizado" });
      return;
    }

    if (pgfnSyncInFlight) {
      sendJson(res, 409, { error: "Sincronização PGFN já está em andamento" });
      return;
    }

    try {
      pgfnSyncInFlight = runPgfnSyncJob();
      const result = await pgfnSyncInFlight;
      sendJson(res, 200, result);
    } catch (error) {
      console.error("PGFN sync failed:", error);
      sendJson(res, 500, { error: "Falha ao executar sincronização PGFN" });
    } finally {
      pgfnSyncInFlight = null;
    }

    return;
  }

  await serveStatic(req, res, pathname);
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Server running on http://0.0.0.0:${port}`);
});
