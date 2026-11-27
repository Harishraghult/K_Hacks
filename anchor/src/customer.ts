/** Customer-facing API: username/password accounts, each with its own custodial testnet wallet. */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { ALL_ASSETS, Big, COUNTRIES, CURRENCY, EXPLORER_BASE, FIATS, ASSET_OF_COUNTRY, type AccountBook, type Fiat, type Recipient } from "@remit/shared";
import { checkLogin, createSession, currentUser, destroySession, hashPassword, loginLockedFor } from "./auth.js";
import { setAuthorized, trustlines } from "./chain.js";
import { db } from "./db.js";
import { KYC_DENY_NAMES } from "./personas.js";
import { getRow, toView, type TransferRow } from "./repo.js";
import { HttpError, isSanctioned, kycPassed } from "./service.js";
import { openStream } from "./sse.js";
import { addMissingTrustlines, createUser, provisionWallet, resumeProvisioning, seedDemoUsers, userByUsername, type UserRow } from "./wallets.js";

interface Ctx {
  book: AccountBook;
  depositFor: (senderId: string, amount: unknown, currency: Fiat) => Promise<unknown>;
  transferFor: (senderId: string, quoteId: string, recipient: Recipient, purpose: string) => Promise<unknown>;
  parse: <T>(schema: z.ZodType<T>, data: unknown) => T;
  RecipientSchema: z.ZodType<Recipient>;
  invalidateSenders: () => void;
}

const Username = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9_]{3,20}$/, "Username: 3–20 letters, numbers or _");
const Password = z.string().min(8, "Password must be at least 8 characters").max(72, "Password too long");

function requireUser(req: FastifyRequest): UserRow {
  const u = currentUser(req);
  if (!u) throw new HttpError(401, "Please sign in", "UNAUTHENTICATED");
  return u;
}

export async function registerCustomerRoutes(app: FastifyInstance, ctx: Ctx) {
  const { book, parse } = ctx;
  seedDemoUsers(book, hashPassword);
  resumeProvisioning(book);
  // Upgrade customer wallets created before every corridor existed (adds the tINR trustline, authorises it if KYC'd).
  void (async () => {
    const rows = db.prepare("SELECT username, wallet_pub FROM users WHERE wallet_status = 'READY' AND wallet_secret_enc IS NOT NULL").all() as unknown as { username: string; wallet_pub: string }[];
    for (const r of rows) {
      try {
        const added = await addMissingTrustlines(book, r.username);
        if (added.length && kycPassed(r.wallet_pub) && !isSanctioned(r.wallet_pub)) await setAuthorized(book, r.wallet_pub, added, true);
        if (added.length) app.log.info(`wallet ${r.username}: added ${added.join(", ")} trustline(s)`);
      } catch (e) {
        app.log.warn(`wallet upgrade for ${r.username} failed: ${(e as Error).message}`);
      }
    }
  })();

  function profile(u: UserRow) {
    return {
      username: u.username,
      displayName: u.display_name,
      country: u.country,
      sendCurrency: CURRENCY[ASSET_OF_COUNTRY[u.country]].fiat,
      walletAddress: u.wallet_pub,
      walletExplorer: `${EXPLORER_BASE}/account/${u.wallet_pub}`,
      walletStatus: u.wallet_status,
      walletError: u.wallet_error,
      kyc: kycPassed(u.wallet_pub) ? "VERIFIED" : "NOT_VERIFIED",
      restricted: isSanctioned(u.wallet_pub),
      memberSince: u.created_at,
    };
  }

  // ---------------- auth ----------------

  app.post("/auth/signup", async (req, reply) => {
    const body = parse(
      z.object({ username: Username, password: Password, fullName: z.string().trim().min(2, "Enter your full name").max(80), country: z.enum(COUNTRIES as [string, ...string[]]).transform((c) => c as UserRow["country"]) }),
      req.body,
    );
    if (body.password.toLowerCase().includes(body.username)) throw new HttpError(400, "Password must not contain your username", "WEAK_PASSWORD");
    if (userByUsername(body.username)) throw new HttpError(409, "That username is taken", "USERNAME_TAKEN");
    const u = createUser({ username: body.username, displayName: body.fullName, passwordHash: hashPassword(body.password), country: body.country });
    createSession(reply, u.username);
    void provisionWallet(book, u.username).catch((e) => app.log.warn(`wallet provisioning for ${u.username} failed: ${(e as Error).message}`));
    return reply.status(201).send(profile(u));
  });

  app.post("/auth/login", async (req, reply) => {
    const body = parse(z.object({ username: Username, password: z.string().min(1).max(200) }), req.body);
    const lockKey = `${body.username}|${req.ip}`;
    const wait = loginLockedFor(lockKey);
    if (wait) throw new HttpError(429, `Too many attempts. Try again in ${wait}s.`, "LOCKED");
    const u = checkLogin(body.username, body.password, req.ip);
    if (!u) throw new HttpError(401, "Wrong username or password", "BAD_CREDENTIALS");
    createSession(reply, u.username);
    return profile(u);
  });

  app.post("/auth/logout", async (req, reply) => {
    destroySession(req, reply);
    return { ok: true };
  });

  // 200 + null when signed out (not 401): the app calls this on every page load to find out.
  app.get("/auth/me", async (req) => {
    const u = currentUser(req);
    return u ? profile(u) : null;
  });

  // ---------------- wallet ----------------

  app.get("/me/wallet", async (req) => {
    const u = requireUser(req);
    const lines = u.wallet_status === "READY" ? await trustlines(book, u.wallet_pub, ALL_ASSETS) : undefined;
    const bank = db.prepare("SELECT currency, balance FROM bank WHERE account_id = ?").get(u.sender_id) as { currency: string; balance: string } | undefined;
    return {
      ...profile(u),
      balances: lines
        ? Object.fromEntries(Object.entries(lines).map(([code, l]) => [code, { balance: l.balance, enabled: l.authorized, frozen: l.exists && !l.authorized && new Big(l.balance).gt(0) }]))
        : null,
      bank: bank ?? null,
    };
  });

  app.post("/me/wallet/retry", async (req) => {
    const u = requireUser(req);
    if (u.wallet_status !== "FAILED") return profile(u);
    db.prepare("UPDATE users SET wallet_status = 'PROVISIONING', wallet_error = NULL WHERE username = ?").run(u.username);
    void provisionWallet(book, u.username).catch(() => undefined);
    return profile(userByUsername(u.username)!);
  });

  /** Mock identity verification. Production: a certified KYC provider (SEP-12). */
  app.post("/me/kyc", async (req) => {
    const u = requireUser(req);
    const body = parse(
      z.object({
        fullName: z.string().trim().min(2).max(80),
        dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date of birth required"),
        idType: z.enum(["EMIRATES_ID", "PASSPORT", "US_STATE_ID", "AADHAAR", "PAN", "NATIONAL_ID", "DRIVERS_LICENSE", "RESIDENCE_PERMIT"]),
        idNumber: z.string().trim().regex(/^[A-Za-z0-9-]{5,24}$/, "Enter a valid ID number"),
      }),
      req.body,
    );
    if (u.wallet_status !== "READY") throw new HttpError(409, "Your wallet is still being set up. Try again in a few seconds.", "WALLET_NOT_READY");
    const dob = new Date(`${body.dob}T00:00:00Z`);
    const age = (Date.now() - dob.getTime()) / (365.25 * 24 * 3600 * 1000);
    if (!Number.isFinite(age) || age < 18) throw new HttpError(400, "You must be 18 or older", "UNDERAGE");
    await new Promise((r) => setTimeout(r, 1200)); // provider latency
    if (KYC_DENY_NAMES.includes(body.fullName.toLowerCase()) || isSanctioned(u.wallet_pub)) {
      db.prepare("INSERT INTO kyc (public_key, name, status, at) VALUES (?, ?, 'REJECTED', ?) ON CONFLICT(public_key) DO UPDATE SET status = 'REJECTED', at = excluded.at").run(u.wallet_pub, body.fullName, Date.now());
      throw new HttpError(403, "We couldn't verify your identity. Please contact support.", "KYC_REJECTED");
    }
    db.prepare("INSERT INTO kyc (public_key, name, status, at) VALUES (?, ?, 'PASSED', ?) ON CONFLICT(public_key) DO UPDATE SET status = 'PASSED', name = excluded.name, at = excluded.at").run(u.wallet_pub, body.fullName, Date.now());
    // The real switch: issuers authorise this wallet's trustlines on-chain.
    await setAuthorized(book, u.wallet_pub, ALL_ASSETS, true);
    ctx.invalidateSenders();
    return profile(u);
  });

  app.post("/me/deposit", async (req) => {
    const u = requireUser(req);
    const body = parse(z.object({ amount: z.union([z.string(), z.number()]), currency: z.enum(FIATS) }), req.body);
    return ctx.depositFor(u.sender_id, body.amount, body.currency);
  });

  // ---------------- transfers ----------------

  app.post("/me/transfer", async (req, reply) => {
    const u = requireUser(req);
    const body = parse(z.object({ quoteId: z.string(), recipient: ctx.RecipientSchema, purpose: z.string().trim().min(2).max(60) }), req.body);
    return reply.status(201).send(await ctx.transferFor(u.sender_id, body.quoteId, body.recipient, body.purpose));
  });

  app.get("/me/transfers", async (req) => {
    const u = requireUser(req);
    const rows = db.prepare("SELECT * FROM transfers WHERE sender_id = ? ORDER BY created_at DESC LIMIT 100").all(u.sender_id) as unknown as TransferRow[];
    return rows.map(toView);
  });

  app.get("/me/transfers/:id", async (req) => {
    const u = requireUser(req);
    const row = getRow((req.params as { id: string }).id);
    if (!row || row.sender_id !== u.sender_id) throw new HttpError(404, "Transfer not found");
    return toView(row);
  });

  /** Saved recipients = distinct people this customer has paid before. */
  app.get("/me/recipients", async (req) => {
    const u = requireUser(req);
    const rows = db
      .prepare("SELECT recipient_json, MAX(created_at) AS last, COUNT(*) AS n FROM transfers WHERE sender_id = ? AND status NOT IN ('BLOCKED') GROUP BY recipient_json ORDER BY last DESC LIMIT 12")
      .all(u.sender_id) as unknown as { recipient_json: string; last: number; n: number }[];
    return rows.map((r) => ({ ...(JSON.parse(r.recipient_json) as Recipient), lastSentAt: r.last, count: r.n }));
  });

  app.get("/me/events", async (req, reply) => {
    const u = requireUser(req);
    openStream(req, reply, u.sender_id);
  });
}
