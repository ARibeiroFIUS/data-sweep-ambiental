import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { findTribunal, loadTribunalDataset, parseCliArgs } from "./tribunal-dataset.mjs";

function printUsage() {
  console.log("Usage: npm run tribunal:codegen -- --tribunal <id> [--dataset <path>] [--output <file>] [--target playwright-test] [--browser chromium]");
}

function runCodegen(args) {
  return new Promise((resolve) => {
    const child = spawn("npx", ["playwright", "codegen", ...args], {
      cwd: process.cwd(),
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    child.on("close", (code) => resolve(code ?? 1));
  });
}

async function main() {
  const options = parseCliArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    process.exit(0);
  }

  const tribunalId = String(options.tribunal ?? "").trim().toLowerCase();
  if (!tribunalId) {
    printUsage();
    throw new Error('Missing required argument: --tribunal "<id>"');
  }

  const { datasetPath, rows } = loadTribunalDataset(options.dataset);
  const tribunal = findTribunal(rows, tribunalId);
  if (!tribunal) {
    const suggestions = rows
      .map((row) => row.tribunal_id)
      .filter((id) => id.includes(tribunalId))
      .slice(0, 8);
    throw new Error(
      suggestions.length > 0
        ? `Tribunal not found: ${tribunalId}. Did you mean: ${suggestions.join(", ")}`
        : `Tribunal not found: ${tribunalId}`,
    );
  }

  const target = String(options.target ?? "playwright-test");
  const browser = String(options.browser ?? "chromium");
  const outputFile = path.resolve(
    process.cwd(),
    String(options.output ?? `artifacts/codegen/${tribunal.tribunal_id}.spec.ts`),
  );
  fs.mkdirSync(path.dirname(outputFile), { recursive: true });

  const codegenArgs = [
    `--target=${target}`,
    `--browser=${browser}`,
    "-o",
    outputFile,
    tribunal.consulta_publica_url,
  ];

  console.log(`Dataset: ${datasetPath}`);
  console.log(`Tribunal: ${tribunal.tribunal_id} - ${tribunal.nome}`);
  console.log(`URL: ${tribunal.consulta_publica_url}`);
  console.log(`Output: ${outputFile}`);
  console.log("Opening Playwright codegen...");
  console.log("When captcha/login appears, solve manually and continue recording.");

  const exitCode = await runCodegen(codegenArgs);
  if (exitCode !== 0) {
    throw new Error(`Playwright codegen exited with code ${exitCode}`);
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});

