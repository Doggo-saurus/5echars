import { spawn } from "node:child_process";

const children = [];
let shuttingDown = false;

function run(command, args, name) {
  const child = spawn(command, args, {
    stdio: "inherit",
    env: process.env,
  });
  child.__name = name;
  children.push(child);
  return child;
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) {
      child.kill("SIGTERM");
    }
  }
  setTimeout(() => {
    for (const child of children) {
      if (!child.killed) {
        child.kill("SIGKILL");
      }
    }
  }, 1500).unref();
  process.exitCode = code;
}

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const clientWatcher = run(npmCommand, ["run", "watch:client"], "watch:client");
const serverWatcher = run(
  "node",
  ["--watch", "--env-file-if-exists=../.env", "src/index.js"],
  "server:watch",
);

for (const child of [clientWatcher, serverWatcher]) {
  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    const reason = signal ? `signal ${signal}` : `exit code ${code ?? 0}`;
    console.error(`[dev] ${child.__name} stopped (${reason}), shutting down.`);
    shutdown(code ?? 0);
  });
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
