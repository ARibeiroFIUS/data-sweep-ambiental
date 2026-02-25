import { closeSourceIndexStore } from "../source-index-store.mjs";
import { runPgfnSyncJob } from "../pgfn-sync.mjs";

function parseOnlySourceIds(argValue) {
  if (!argValue) return [];
  return argValue
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

async function main() {
  const onlyArg = process.argv.find((arg) => arg.startsWith("--only="));
  const onlySourceIds = parseOnlySourceIds(onlyArg ? onlyArg.replace("--only=", "") : "");

  try {
    const result = await runPgfnSyncJob({
      onlySourceIds,
    });
    console.log(JSON.stringify(result, null, 2));

    if (result.status === "partial") {
      process.exitCode = 2;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[pgfn-sync] failed: ${message}`);
    process.exitCode = 1;
  } finally {
    await closeSourceIndexStore();
  }
}

await main();
