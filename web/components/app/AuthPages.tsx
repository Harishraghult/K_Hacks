"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { api } from "@/lib/api";
import { useSession, type Profile } from "@/lib/session";
import { Alert, Button, Field, Input, Select, Spinner } from "./kit";
import { Logo } from "./Shell";

function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-screen grid-cols-1 bg-white lg:grid-cols-[1.05fr_1fr]">
      <section className="relative hidden flex-col justify-between overflow-hidden bg-zinc-950 p-10 text-white lg:flex">
        <div className="absolute -right-24 -top-24 h-96 w-96 rounded-full bg-emerald-500/20 blur-3xl" />
        <div className="absolute -bottom-32 -left-16 h-96 w-96 rounded-full bg-sky-500/10 blur-3xl" />
        <Logo light />
        <div className="relative max-w-md">
          <h2 className="text-4xl font-bold leading-tight tracking-tight">
            Send money home in seconds.
            <br />
            <span className="text-emerald-400">Keep what you earn.</span>
          </h2>
          <ul className="mt-8 space-y-4 text-sm text-zinc-300">
            {[
              ["No transfer fee", "Network cost is a fraction of a cent, not 6–8%."],
              ["Arrives in about 10 seconds", "Straight to UPI or any Indian bank account."],
              ["Best rate, locked in", "We compare routes and guarantee a minimum amount."],
              ["Regulated and safe", "Identity checks and sanctions screening on every transfer."],
            ].map(([a, b]) => (
              <li key={a} className="flex gap-3">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-xs text-emerald-300">✓</span>
                <span>
                  <b className="text-white">{a}</b>
                  <br />
                  {b}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-zinc-500">Prototype running on Stellar testnet. No real money moves.</p>
      </section>
      <section className="flex items-center justify-center p-8">
        <div className="w-full max-w-sm">{children}</div>
      </section>
    </div>
  );
}

function useRedirectIfSignedIn() {
  const { user } = useSession();
  const router = useRouter();
  useEffect(() => {
    if (user) router.replace("/");
  }, [user, router]);
}

const DEMO = [
  { u: "ravi", p: "ravi1234", note: "Dubai · verified, has balance" },
  { u: "maria", p: "maria1234", note: "Houston · verified, sends USD" },
  { u: "newuser", p: "newuser1234", note: "not verified yet" },
  { u: "watchlisted", p: "watch1234", note: "on a sanctions list" },
];

export function LoginPage() {
  useRedirectIfSignedIn();
  const { setUser } = useSession();
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const p = await api<Profile>("/auth/login", { body: { username, password } });
      setUser(p);
      router.replace("/");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout>
      <div className="mb-8 lg:hidden">
        <Logo />
      </div>
      <h1 className="text-2xl font-bold tracking-tight">Welcome back</h1>
      <p className="mt-1 text-sm text-zinc-500">Sign in to send money home.</p>
      <form onSubmit={submit} className="mt-8 space-y-4">
        <Field label="Username">
          <Input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoFocus required />
        </Field>
        <Field label="Password">
          <div className="relative">
            <Input type={show ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required className="pr-16" aria-label="Password" />
            <button type="button" onClick={() => setShow(!show)} aria-label={show ? "Hide password" : "Show password"} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg px-2 py-1 text-xs font-medium text-zinc-500 hover:bg-zinc-100">
              {show ? "Hide" : "Show"}
            </button>
          </div>
        </Field>
        {error && <Alert tone="error">{error}</Alert>}
        <Button type="submit" disabled={busy || !username || !password} className="w-full py-3">
          {busy ? <Spinner /> : "Sign in"}
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-zinc-600">
        New here?{" "}
        <Link href="/signup" className="font-semibold text-emerald-700 hover:underline">
          Create an account
        </Link>
      </p>

      <div className="mt-10 rounded-xl border border-dashed border-zinc-300 p-4">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Demo accounts (click to fill)</div>
        <div className="space-y-1">
          {DEMO.map((d) => (
            <button
              key={d.u}
              type="button"
              onClick={() => {
                setUsername(d.u);
                setPassword(d.p);
              }}
              className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-xs hover:bg-zinc-100"
            >
              <span className="font-mono">
                {d.u} / {d.p}
              </span>
              <span className="text-zinc-500">{d.note}</span>
            </button>
          ))}
        </div>
      </div>
      <p className="mt-4 text-center text-xs text-zinc-400">
        Presenting to judges?{" "}
        <Link href="/demo" className="underline">
          Open the operator view
        </Link>
      </p>
    </AuthLayout>
  );
}

export function SignupPage() {
  useRedirectIfSignedIn();
  const { setUser } = useSession();
  const router = useRouter();
  const [f, setF] = useState({ fullName: "", username: "", password: "", confirm: "", country: "AE" as "AE" | "US" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const uOk = /^[a-z0-9_]{3,20}$/.test(f.username.toLowerCase());
  const pwChecks = [
    { ok: f.password.length >= 8, label: "At least 8 characters" },
    { ok: /\d/.test(f.password) && /[a-zA-Z]/.test(f.password), label: "Letters and numbers" },
    { ok: !!f.username && !f.password.toLowerCase().includes(f.username.toLowerCase()), label: "Doesn't contain your username" },
  ];
  const valid = f.fullName.trim().length >= 2 && uOk && pwChecks.every((c) => c.ok) && f.password === f.confirm;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    setError(undefined);
    try {
      const p = await api<Profile>("/auth/signup", { body: { username: f.username.toLowerCase(), password: f.password, fullName: f.fullName, country: f.country } });
      setUser(p);
      router.replace("/");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout>
      <h1 className="text-2xl font-bold tracking-tight">Create your account</h1>
      <p className="mt-1 text-sm text-zinc-500">Takes a minute. You&apos;ll verify your ID next.</p>
      <form onSubmit={submit} className="mt-6 space-y-4">
        <Field label="Full name (as on your ID)">
          <Input value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} autoComplete="name" autoFocus required />
        </Field>
        <Field label="Username" error={f.username && !uOk ? "3–20 lowercase letters, numbers or _" : undefined}>
          <Input value={f.username} onChange={(e) => setF({ ...f, username: e.target.value.toLowerCase() })} autoComplete="username" required />
        </Field>
        <Field label="Where do you live?">
          <Select value={f.country} onChange={(e) => setF({ ...f, country: e.target.value as "AE" | "US" })}>
            <option value="AE">United Arab Emirates (send in AED)</option>
            <option value="US">United States (send in USD)</option>
          </Select>
        </Field>
        <div>
          <Field label="Password">
            <Input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete="new-password" required aria-describedby="pw-rules" />
          </Field>
          <ul id="pw-rules" className="mt-2 space-y-0.5">
            {pwChecks.map((c) => (
              <li key={c.label} className={`text-xs ${c.ok ? "text-emerald-700" : "text-zinc-400"}`}>
                {c.ok ? "✓" : "○"} {c.label}
              </li>
            ))}
          </ul>
        </div>
        <Field label="Confirm password" error={f.confirm && f.confirm !== f.password ? "Passwords don't match" : undefined}>
          <Input type="password" value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} autoComplete="new-password" required />
        </Field>
        {error && <Alert tone="error">{error}</Alert>}
        <Button type="submit" disabled={busy || !valid} className="w-full py-3">
          {busy ? <Spinner /> : "Create account"}
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-zinc-600">
        Already have an account?{" "}
        <Link href="/login" className="font-semibold text-emerald-700 hover:underline">
          Sign in
        </Link>
      </p>
    </AuthLayout>
  );
}
