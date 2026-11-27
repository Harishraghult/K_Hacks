/**
 * One command to run the whole demo on a laptop:  npm start   (or double-click start.bat)
 *  1. creates .env if missing
 *  2. bootstraps testnet if accounts are missing (first run, or after a testnet reset)
 *  3. builds the web UI if it has never been built or the source changed
 *  4. starts the anchor (:4000) and the web UI (:3000), opens the browser
 *  5. Ctrl+C stops both
 */
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { ACCOUNT_NAMES, BOOTSTRAP_VERSION, accountsFile, dataDir, loadAccountOrNull, repoRoot } from "@remit/shared";

const root = repoRoot();
const ANCHOR_PORT = 4000;
const WEB_PORT = 3000;
const URL = `http://localhost:${WEB_PORT}`;
const tsxCli = path.join(root, "node_modules", "tsx", "dist", "cli.mjs");
const nextCli = path.join(root, "node_modules", "next", "dist", "bin", "next");

const step = (s: string) => console.log(`\n▶ ${s}`);
const portBusy = (port: number) =>
  new Promise<boolean>((resolve) => {
    const s = net.connect({ port, host: "127.0.0.1" }, () => (s.end(), resolve(true)));
    s.on("error", () => resolve(false));
  });

function openBrowser() {
  if (process.env.NO_BROWSER) return;
  if (process.platform === "win32") spawn("cmd", ["/c", "start", "", URL], { detached: true, stdio: "ignore" }).unref();
  else spawn(process.platform === "darwin" ? "open" : "xdg-open", [URL], { detached: true, stdio: "ignore" }).unref();
}

function newestMtime(dir: string): number {
  let newest = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === ".next") continue;
    const p = path.join(dir, e.name);
    newest = Math.max(newest, e.isDirectory() ? newestMtime(p) : fs.statSync(p).mtimeMs);
  }
  return newest;
}

function run(label: string, cmd: string[], cwd: string): ChildProcess {
  const child = spawn(process.execPath, cmd, { cwd, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
  const prefix = (chunk: Buffer) =>
    chunk
      .toString()
      .split(/\r?\n/)
      .filter((l) => l.trim() && !l.includes('"level":30')) // hide per-request info logs
      .forEach((l) => console.log(`[${label}] ${l}`));
  child.stdout!.on("data", prefix);
  child.stderr!.on("data", prefix);
  return child;
}

async function waitFor(url: string, timeoutMs: number) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (r.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 700));
  }
  return false;
}

console.log("RemitRail: compliant remittances on Stellar testnet");

// 0. Already running?
const [anchorUp, webUp] = await Promise.all([portBusy(ANCHOR_PORT), portBusy(WEB_PORT)]);
if (anchorUp && webUp) {
  console.log(`\nAlready running. Opening ${URL}`);
  openBrowser();
  process.exit(0);
}
if (anchorUp || webUp) {
  console.error(`\nPort ${anchorUp ? ANCHOR_PORT : WEB_PORT} is in use by another program. Close it and try again.`);
  process.exit(1);
}

// 1. .env
if (!fs.existsSync(path.join(root, ".env"))) {
  fs.copyFileSync(path.join(root, ".env.example"), path.join(root, ".env"));
  const env = fs.readFileSync(path.join(root, ".env"), "utf8").replace("ADMIN_TOKEN=change-me", "ADMIN_TOKEN=demo-admin");
  fs.writeFileSync(path.join(root, ".env"), env);
  step("Created .env (admin token: demo-admin)");
}

// 2. Testnet accounts
step("Checking Stellar testnet…");
let needBootstrap = !fs.existsSync(accountsFile());
if (!needBootstrap) {
  const acc = JSON.parse(fs.readFileSync(accountsFile(), "utf8"));
  const netFile = path.join(dataDir(), "network.json");
  const version = fs.existsSync(netFile) ? Number(JSON.parse(fs.readFileSync(netFile, "utf8")).bootstrapVersion ?? 1) : 0;
  // Older setup (e.g. before all 6 corridors existed) or a new demo account: re-run the idempotent bootstrap.
  if (version < BOOTSTRAP_VERSION || ACCOUNT_NAMES.some((n) => !acc[n])) {
    console.log(`  testnet setup is v${version}, this code needs v${BOOTSTRAP_VERSION}: upgrading`);
    needBootstrap = true;
  }
  try {
    needBootstrap ||= !(await loadAccountOrNull(acc.ANCHOR_RECV.publicKey)) || !(await loadAccountOrNull(acc.ISSUER_INR.publicKey));
  } catch {
    console.error("  Cannot reach Stellar testnet (horizon-testnet.stellar.org). Check your internet connection.");
    process.exit(1);
  }
}
if (needBootstrap) {
  step("Setting up testnet accounts, tokens and liquidity (first run or testnet reset, ~1 minute)…");
  const r = spawnSync(process.execPath, [tsxCli, path.join(root, "scripts", "src", "bootstrap.ts")], { cwd: root, stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
} else console.log("  testnet accounts ok");

// 3. Web build
const webDir = path.join(root, "web");
const buildId = path.join(webDir, ".next", "BUILD_ID");
const srcNewest = Math.max(...["app", "components", "lib"].map((d) => newestMtime(path.join(webDir, d))), newestMtime(path.join(root, "shared", "src")));
if (!fs.existsSync(buildId) || fs.statSync(buildId).mtimeMs < srcNewest) {
  step("Building the web UI (one-time, ~30 seconds)…");
  const r = spawnSync(process.execPath, [nextCli, "build"], { cwd: webDir, stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

// 4. Start both servers
step("Starting anchor server and web UI…");
const children = [
  run("anchor", [tsxCli, path.join(root, "anchor", "src", "server.ts")], path.join(root, "anchor")),
  run("web", [nextCli, "start", "-p", String(WEB_PORT)], webDir),
];
let stopping = false;
function stopAll(code = 0) {
  if (stopping) return;
  stopping = true;
  console.log("\nStopping…");
  for (const c of children) {
    if (c.exitCode !== null || !c.pid) continue;
    if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(c.pid), "/T", "/F"], { stdio: "ignore" });
    else c.kill("SIGTERM");
  }
  process.exit(code);
}
process.on("SIGINT", () => stopAll(0));
process.on("SIGTERM", () => stopAll(0));
children.forEach((c, i) =>
  c.on("exit", (code) => {
    if (!stopping) {
      console.error(`\n${i === 0 ? "Anchor" : "Web"} server exited (code ${code}). Stopping.`);
      stopAll(1);
    }
  }),
);

const ok = (await waitFor(`http://localhost:${ANCHOR_PORT}/health`, 60000)) && (await waitFor(URL, 60000));
if (!ok) {
  console.error("Servers did not start in time.");
  stopAll(1);
}
console.log(`\n✔ Ready:  ${URL}\n  Admin token for the Compliance console: ${process.env.ADMIN_TOKEN ?? "demo-admin"}\n  Press Ctrl+C to stop.\n`);
openBrowser();
