import fs from "node:fs";
import { createReadStream, createWriteStream } from "node:fs";
import { promises as fsp } from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createHash } from "node:crypto";
import iconv from "iconv-lite";
import unzipper from "unzipper";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import {
  cleanupSourceIndexToSnapshot,
  createSourceJobRun,
  ensureSourceIndexStoreReachable,
  finishSourceJobRun,
  isSourceIndexStoreEnabled,
  recordSourceSnapshot,
  upsertSourceIndexBatch,
} from "./source-index-store.mjs";
import { cleanDocument, parseDelimitedLine, resolveHeaderIndexAny } from "./common-utils.mjs";
import { fetchWithTimeout, urlExists } from "./http-utils.mjs";
import { PGFN_SOURCE_IDS, SOURCE_REGISTRY } from "./source-registry.mjs";

const PGFN_ROOT_URL = "https://dadosabertos.pgfn.gov.br/";
const SNAPSHOT_ROW_RUNNING = "running";
const DEFAULT_BATCH_SIZE = Number.parseInt(process.env.PGFN_BATCH_SIZE ?? "500", 10);
const DOWNLOAD_TIMEOUT_MS = Number.parseInt(process.env.PGFN_DOWNLOAD_TIMEOUT_MS ?? `${2 * 60 * 60 * 1000}`, 10);

const PGFN_FILES = [
  {
    sourceId: "pgfn_fgts",
    fileName: "Dados_abertos_FGTS.zip",
    documentHeaders: ["CPF_CNPJ"],
  },
  {
    sourceId: "pgfn_previdenciario",
    fileName: "Dados_abertos_Previdenciario.zip",
    documentHeaders: ["CPF_CNPJ"],
  },
  {
    sourceId: "pgfn_nao_previdenciario",
    fileName: "Dados_abertos_Nao_Previdenciario.zip",
    documentHeaders: ["CPF_CNPJ"],
  },
];

/** @type {S3Client | null} */
let s3Client = null;

function resolveS3Config() {
  const endpoint = (process.env.S3_ENDPOINT ?? "").trim();
  const region = (process.env.S3_REGION ?? "").trim() || "us-east-1";
  const bucket = (process.env.S3_BUCKET ?? "").trim();
  const accessKeyId = (process.env.S3_ACCESS_KEY_ID ?? "").trim();
  const secretAccessKey = (process.env.S3_SECRET_ACCESS_KEY ?? "").trim();

  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    return null;
  }

  return { endpoint, region, bucket, accessKeyId, secretAccessKey };
}

function getS3Client() {
  const config = resolveS3Config();
  if (!config) return null;

  if (!s3Client) {
    s3Client = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  return { client: s3Client, bucket: config.bucket };
}

function parseQuarterToken(directoryName) {
  const match = String(directoryName).match(/(\d{4})_trimestre_(0[1-4])/i);
  if (!match) return null;

  return {
    year: Number.parseInt(match[1], 10),
    quarter: Number.parseInt(match[2], 10),
    token: `${match[1]}_trimestre_${match[2]}`,
  };
}

function sortQuarterTokensDesc(tokens) {
  return [...tokens].sort((a, b) => {
    if (a.year !== b.year) return b.year - a.year;
    return b.quarter - a.quarter;
  });
}

function parseQuarterDirectories(html) {
  const tokens = new Map();
  const regex = /href="(\d{4}_trimestre_0[1-4])\/?"/gi;

  let match = regex.exec(html);
  while (match) {
    const parsed = parseQuarterToken(match[1]);
    if (parsed) {
      tokens.set(parsed.token, parsed);
    }
    match = regex.exec(html);
  }

  return sortQuarterTokensDesc(Array.from(tokens.values()));
}

async function resolveLatestQuarterBaseUrl() {
  const response = await fetchWithTimeout(PGFN_ROOT_URL, 20000);
  if (!response || !response.ok) {
    throw new Error("Não foi possível carregar o catálogo de dados abertos da PGFN");
  }

  const html = await response.text();
  const quarterTokens = parseQuarterDirectories(html);

  if (quarterTokens.length === 0) {
    throw new Error("Nenhum trimestre PGFN encontrado no catálogo");
  }

  for (const token of quarterTokens) {
    const baseUrl = `${PGFN_ROOT_URL}${token.token}/`;

    const fileChecks = await Promise.all(
      PGFN_FILES.map((file) => urlExists(`${baseUrl}${file.fileName}`, 15000)),
    );

    if (fileChecks.every(Boolean)) {
      return {
        token: token.token,
        baseUrl,
      };
    }
  }

  throw new Error("Nenhum diretório trimestral da PGFN possui os 3 pacotes esperados (FGTS, Previdenciário, Não-Previdenciário)");
}

async function downloadToFile(url, destinationFilePath, timeoutMs) {
  const response = await fetchWithTimeout(url, timeoutMs);
  if (!response || !response.ok || !response.body) {
    throw new Error(`Falha no download: ${url}`);
  }

  await pipeline(Readable.fromWeb(response.body), createWriteStream(destinationFilePath));
}

async function sha256File(filePath) {
  const hash = createHash("sha256");

  await new Promise((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });

  return hash.digest("hex");
}

async function uploadArtifactToBucket(localFilePath, objectKey) {
  const s3 = getS3Client();
  if (!s3) return null;

  const fileStream = createReadStream(localFilePath);
  const command = new PutObjectCommand({
    Bucket: s3.bucket,
    Key: objectKey,
    Body: fileStream,
    ContentType: "application/zip",
  });

  await s3.client.send(command);
  return `s3://${s3.bucket}/${objectKey}`;
}

async function indexZipFileByCnpj(sourceId, zipFilePath, snapshotRef, documentHeaders, batchSize) {
  let rowsRead = 0;
  let rowsIndexed = 0;
  const pendingBatch = [];

  const zipEntries = createReadStream(zipFilePath).pipe(unzipper.Parse({ forceStream: true }));

  for await (const entry of zipEntries) {
    const fileName = entry.path ?? "";
    if (!fileName.toLowerCase().endsWith(".csv")) {
      entry.autodrain();
      continue;
    }

    const decoded = entry.pipe(iconv.decodeStream("latin1"));
    const lineReader = readline.createInterface({
      input: decoded,
      crlfDelay: Infinity,
    });

    let documentIndex = -1;

    for await (const line of lineReader) {
      rowsRead += 1;
      if (!line) continue;

      if (documentIndex < 0) {
        const headers = parseDelimitedLine(line, ";");
        documentIndex = resolveHeaderIndexAny(headers, documentHeaders);
        if (documentIndex < 0) {
          break;
        }
        continue;
      }

      const columns = parseDelimitedLine(line, ";");
      const cnpj = cleanDocument(columns[documentIndex] ?? "");

      if (cnpj.length !== 14) continue;

      pendingBatch.push({
        cnpj,
        payload: {
          file: fileName,
        },
      });

      if (pendingBatch.length >= batchSize) {
        await upsertSourceIndexBatch(sourceId, snapshotRef, pendingBatch);
        rowsIndexed += pendingBatch.length;
        pendingBatch.length = 0;
      }
    }
  }

  if (pendingBatch.length > 0) {
    await upsertSourceIndexBatch(sourceId, snapshotRef, pendingBatch);
    rowsIndexed += pendingBatch.length;
  }

  return { rowsRead, rowsIndexed };
}

function buildSnapshotRef(quarterToken) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "").replace("T", "_").slice(0, 15);
  return `${quarterToken}_${stamp}`;
}

async function syncSingleSource({ sourceId, fileName, baseUrl, quarterToken, tempDir, batchSize }) {
  const source = SOURCE_REGISTRY[sourceId];
  const jobRunId = await createSourceJobRun(sourceId);
  const snapshotRef = buildSnapshotRef(quarterToken);

  const downloadUrl = `${baseUrl}${fileName}`;
  const localZipPath = path.join(tempDir, `${sourceId}.zip`);
  const artifactObjectKey = `pgfn/${quarterToken}/${sourceId}/${path.basename(localZipPath)}`;

  let rowsRead = 0;
  let rowsIndexed = 0;

  try {
    await recordSourceSnapshot(sourceId, snapshotRef, {
      fetchedAt: new Date(),
      checksum: null,
      status: SNAPSHOT_ROW_RUNNING,
      rowCount: 0,
    });

    await downloadToFile(downloadUrl, localZipPath, DOWNLOAD_TIMEOUT_MS);
    const checksum = await sha256File(localZipPath);
    const artifactRef = await uploadArtifactToBucket(localZipPath, artifactObjectKey);

    const metrics = await indexZipFileByCnpj(
      sourceId,
      localZipPath,
      snapshotRef,
      PGFN_FILES.find((item) => item.sourceId === sourceId)?.documentHeaders ?? ["CPF_CNPJ"],
      batchSize,
    );

    rowsRead = metrics.rowsRead;
    rowsIndexed = metrics.rowsIndexed;

    await cleanupSourceIndexToSnapshot(sourceId, snapshotRef);

    await recordSourceSnapshot(sourceId, snapshotRef, {
      fetchedAt: new Date(),
      checksum,
      status: "success",
      rowCount: rowsIndexed,
    });

    await finishSourceJobRun(jobRunId, "success", {
      rowsRead,
      rowsIndexed,
    });

    return {
      sourceId,
      sourceName: source?.name ?? sourceId,
      status: "success",
      rowsRead,
      rowsIndexed,
      snapshotRef,
      checksum,
      artifactRef,
      downloadUrl,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    await recordSourceSnapshot(sourceId, snapshotRef, {
      fetchedAt: new Date(),
      checksum: null,
      status: "error",
      rowCount: rowsIndexed,
    });

    await finishSourceJobRun(jobRunId, "error", {
      rowsRead,
      rowsIndexed,
      errorText: message,
    });

    return {
      sourceId,
      sourceName: source?.name ?? sourceId,
      status: "error",
      error: message,
      rowsRead,
      rowsIndexed,
      snapshotRef,
      downloadUrl,
    };
  } finally {
    await fsp.rm(localZipPath, { force: true });
  }
}

export async function runPgfnSyncJob(options = {}) {
  if (!isSourceIndexStoreEnabled()) {
    throw new Error("DATABASE_URL não configurado. Índice PGFN requer Postgres no Railway.");
  }

  await ensureSourceIndexStoreReachable();

  const onlySourceIds = Array.isArray(options.onlySourceIds) && options.onlySourceIds.length > 0
    ? options.onlySourceIds.filter((sourceId) => PGFN_SOURCE_IDS.includes(sourceId))
    : PGFN_SOURCE_IDS;

  const { token: quarterToken, baseUrl } = await resolveLatestQuarterBaseUrl();
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "pgfn-sync-"));

  try {
    const sourceFiles = PGFN_FILES.filter((entry) => onlySourceIds.includes(entry.sourceId));
    const results = [];

    for (const sourceFile of sourceFiles) {
      const result = await syncSingleSource({
        sourceId: sourceFile.sourceId,
        fileName: sourceFile.fileName,
        baseUrl,
        quarterToken,
        tempDir,
        batchSize: Number.isFinite(options.batchSize) ? options.batchSize : DEFAULT_BATCH_SIZE,
      });
      results.push(result);
    }

    return {
      status: results.some((result) => result.status === "error") ? "partial" : "success",
      quarterToken,
      baseUrl,
      results,
      finishedAt: new Date().toISOString(),
    };
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true });
  }
}
