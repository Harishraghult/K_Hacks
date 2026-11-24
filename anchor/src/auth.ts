import crypto from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { db } from "./db.js";
import { userByUsername, type UserRow } from "./wallets.js";

export const SESSION_COOKIE = "rr_session";
const SESSION_TTL_MS = 7 * 24 * 3600 * 1000;

// ---------------- passwords (scrypt, per-user salt) ----------------

export function hashPassword(pw: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export function verifyPassword(pw: string, stored: string): boolean {
  const [alg, saltB64, hashB64] = stored.split("$");
  if (alg !== "scrypt" || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, "base64");
  const actual = crypto.scryptSync(pw, Buffer.from(saltB64, "base64"), expected.length, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(expected, actual);
}

// Burn the same CPU when the user doesn't exist, so response time doesn't reveal valid usernames.
const DUMMY_HASH = hashPassword(crypto.randomBytes(16).toString("hex"));

// ---------------- login throttling ----------------

const failures = new Map<string, { count: number; until: number }>();
const MAX_FAILS = 5;
const LOCK_MS = 60_000;

export function loginLockedFor(key: string): number {
  const f = failures.get(key);
  return f && f.until > Date.now() ? Math.ceil((f.until - Date.now()) / 1000) : 0;
}
function recordFailure(key: string) {
  const f = failures.get(key) ?? { count: 0, until: 0 };
  f.count++;
  if (f.count >= MAX_FAILS) {
    f.until = Date.now() + LOCK_MS;
    f.count = 0;
  }
  failures.set(key, f);
}

export function checkLogin(username: string, password: string, ip: string): UserRow | undefined {
  const key = `${username}|${ip}`;
  const user = userByUsername(username);
  const ok = verifyPassword(password, user?.password_hash ?? DUMMY_HASH) && !!user;
  if (!ok) {
    recordFailure(key);
    return undefined;
  }
  failures.delete(key);
  return user;
}

// ---------------- sessions (random token in an HttpOnly cookie; only its hash is stored) ----------------

const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

export function createSession(reply: FastifyReply, username: string) {
  const token = crypto.randomBytes(32).toString("base64url");
  db.prepare("INSERT INTO sessions (token_hash, username, expires_at) VALUES (?, ?, ?)").run(sha256(token), username, Date.now() + SESSION_TTL_MS);
  db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(Date.now());
  reply.header("Set-Cookie", `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_MS / 1000}`);
}

function tokenFrom(req: FastifyRequest): string | undefined {
  const raw = req.headers.cookie;
  if (!raw) return undefined;
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === SESSION_COOKIE) return v.join("=");
  }
  return undefined;
}

export function currentUser(req: FastifyRequest): UserRow | undefined {
  const token = tokenFrom(req);
  if (!token) return undefined;
  const s = db.prepare("SELECT username, expires_at FROM sessions WHERE token_hash = ?").get(sha256(token)) as { username: string; expires_at: number } | undefined;
  if (!s || s.expires_at < Date.now()) return undefined;
  return userByUsername(s.username);
}

export function destroySession(req: FastifyRequest, reply: FastifyReply) {
  const token = tokenFrom(req);
  if (token) db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(sha256(token));
  reply.header("Set-Cookie", `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}
