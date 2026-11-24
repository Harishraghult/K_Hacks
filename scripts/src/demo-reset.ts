/** npm run demo:reset — wipe the anchor DB and restore the canonical testnet demo state. Stop the anchor first. */
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { dataDir } from "@remit/shared";

const port = Number(process.env.ANCHOR_PORT ?? 4000);
const inUse = await new Promise<boolean>((resolve) => {
  const s = net.connect({ port, host: "127.0.0.1" }, () => (s.end(), resolve(true)));
  s.on("error", () => resolve(false));
});
if (inUse) {
  console.error(`The anchor server is still running on port ${port}. Stop it first (Ctrl+C), then re-run demo:reset.`);
  process.exit(1);
}
for (const f of ["anchor.db", "anchor.db-wal", "anchor.db-shm"]) {
  const p = path.join(dataDir(), f);
  if (fs.existsSync(p)) {
    fs.rmSync(p);
    console.log(`• removed ${p}`);
  }
}
const r = spawnSync(process.execPath, [...process.execArgv, path.join(import.meta.dirname, "bootstrap.ts"), "--reset-auth"], { stdio: "inherit" });
process.exit(r.status ?? 1);
