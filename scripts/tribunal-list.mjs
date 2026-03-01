import { loadTribunalDataset, parseCliArgs } from "./tribunal-dataset.mjs";

function printUsage() {
  console.log("Usage: npm run tribunal:list -- [--dataset <path>] [--family <name>] [--ramo <name>] [--contains <text>] [--json]");
}

function matchesFilter(row, options) {
  const family = String(options.family ?? "").trim().toLowerCase();
  const ramo = String(options.ramo ?? "").trim().toLowerCase();
  const contains = String(options.contains ?? "").trim().toLowerCase();

  if (family && row.connector_family.toLowerCase() !== family) return false;
  if (ramo && row.ramo.toLowerCase() !== ramo) return false;
  if (contains) {
    const haystack = `${row.tribunal_id} ${row.nome} ${row.consulta_publica_url}`.toLowerCase();
    if (!haystack.includes(contains)) return false;
  }
  return true;
}

function pad(value, width) {
  const text = String(value ?? "");
  if (text.length >= width) return text;
  return `${text}${" ".repeat(width - text.length)}`;
}

function printTable(rows) {
  const header =
    `${pad("tribunal_id", 12)}  ` +
    `${pad("family", 10)}  ` +
    `${pad("ramo", 16)}  ` +
    `${pad("nome", 48)}  ` +
    "consulta_publica_url";
  console.log(header);
  console.log("-".repeat(header.length));
  for (const row of rows) {
    console.log(
      `${pad(row.tribunal_id, 12)}  ${pad(row.connector_family, 10)}  ${pad(row.ramo, 16)}  ${pad(row.nome, 48)}  ${row.consulta_publica_url}`,
    );
  }
}

function main() {
  const options = parseCliArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    process.exit(0);
  }

  const { datasetPath, rows } = loadTribunalDataset(options.dataset);
  const filtered = rows.filter((row) => matchesFilter(row, options));

  if (options.json) {
    console.log(JSON.stringify({ datasetPath, total: filtered.length, rows: filtered }, null, 2));
    return;
  }

  console.log(`Dataset: ${datasetPath}`);
  console.log(`Total: ${filtered.length}`);
  printTable(filtered);
}

main();

