import { spawn } from "node:child_process";
import process from "node:process";

const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";

/** @type {import("node:child_process").ChildProcess[]} */
const children = [];
let shuttingDown = false;

function prefixOutput(stream, prefix) {
  let buffer = "";
  stream.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      console.log(`${prefix} ${line}`);
    }
  });

  stream.on("end", () => {
    if (buffer.trim()) {
      console.log(`${prefix} ${buffer}`);
    }
  });
}

function spawnNpmScript(scriptName, label) {
  const child = spawn(npmCmd, ["run", scriptName], {
    stdio: ["inherit", "pipe", "pipe"],
    env: process.env,
  });

  children.push(child);
  if (child.stdout) prefixOutput(child.stdout, `[${label}]`);
  if (child.stderr) prefixOutput(child.stderr, `[${label}]`);

  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    shuttingDown = true;

    for (const sibling of children) {
      if (sibling.pid && sibling !== child) {
        sibling.kill("SIGTERM");
      }
    }

    if (signal) {
      process.exit(1);
      return;
    }

    process.exit(Number.isInteger(code) ? code : 1);
  });
}

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (child.pid) child.kill("SIGTERM");
  }
  setTimeout(() => process.exit(0), 200);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

spawnNpmScript("dev:api", "api");
spawnNpmScript("dev:ui", "ui");
