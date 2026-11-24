// Imported first by server.ts so .env is loaded before any module reads process.env.
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

function findRoot(dir = process.cwd()): string {
  for (;;) {
    const pkg = path.join(dir, "package.json");
    if (fs.existsSync(pkg) && fs.readFileSync(pkg, "utf8").includes('"workspaces"')) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return process.cwd();
    dir = parent;
  }
}
dotenv.config({ path: path.join(findRoot(), ".env"), quiet: true });

export const ENV = {
  PORT: Number(process.env.ANCHOR_PORT ?? 4000),
  WEB_ORIGINS: (process.env.WEB_ORIGIN ?? "http://localhost:3000").split(",").map((s) => s.trim()),
  ADMIN_TOKEN: process.env.ADMIN_TOKEN ?? "demo-admin",
};
