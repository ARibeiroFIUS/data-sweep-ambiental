import fs from "node:fs";
import path from "node:path";

export const DEFAULT_DATASET_PATH = path.resolve(
  process.cwd(),
  "docs/tribunais-consulta-publica-92.tsv",
);

export function parseCliArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      options[key] = true;
      continue;
    }
    options[key] = next;
    i += 1;
  }
  return options;
}

export function resolveDatasetPath(customPath) {
  if (!customPath) return DEFAULT_DATASET_PATH;
  return path.resolve(process.cwd(), customPath);
}

export function loadTribunalDataset(customPath) {
  const datasetPath = resolveDatasetPath(customPath);
  if (!fs.existsSync(datasetPath)) {
    throw new Error(`Dataset not found: ${datasetPath}`);
  }

  const text = fs.readFileSync(datasetPath, "utf8").replace(/\r/g, "");
  const lines = text.split("\n").filter(Boolean);
  if (lines.length < 2) {
    throw new Error(`Dataset has no rows: ${datasetPath}`);
  }

  const header = lines[0].split("\t");
  const index = Object.fromEntries(header.map((name, i) => [name, i]));
  const required = [
    "tribunal_id",
    "nome",
    "ramo",
    "connector_family",
    "consulta_publica_url",
  ];
  for (const field of required) {
    if (!Object.hasOwn(index, field)) {
      throw new Error(`Dataset missing field "${field}" in ${datasetPath}`);
    }
  }

  const rows = lines.slice(1).map((line) => {
    const cols = line.split("\t");
    return {
      tribunal_id: String(cols[index.tribunal_id] ?? "").trim(),
      nome: String(cols[index.nome] ?? "").trim(),
      ramo: String(cols[index.ramo] ?? "").trim(),
      connector_family: String(cols[index.connector_family] ?? "").trim(),
      consulta_publica_url: String(cols[index.consulta_publica_url] ?? "").trim(),
    };
  });

  return { datasetPath, rows };
}

export function findTribunal(rows, tribunalId) {
  const target = String(tribunalId ?? "").trim().toLowerCase();
  return rows.find((row) => row.tribunal_id.toLowerCase() === target) ?? null;
}

