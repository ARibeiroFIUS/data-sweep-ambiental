import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadPublicSearchUrlMap() {
  const map = {};
  const filePath = path.resolve(__dirname, "../docs/tribunais-consulta-publica-92.tsv");
  let raw = "";
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch {
    return map;
  }

  const lines = raw.split(/\r?\n/).filter(Boolean);
  if (lines.length <= 1) return map;

  for (const line of lines.slice(1)) {
    const [tribunalId, , , , url] = line.split("\t");
    const key = String(tribunalId ?? "").trim().toLowerCase();
    const value = String(url ?? "").trim();
    if (!key || !value) continue;
    map[key] = value;
  }

  return map;
}

export const PUBLIC_SEARCH_URL_BY_TRIBUNAL = Object.freeze(loadPublicSearchUrlMap());

