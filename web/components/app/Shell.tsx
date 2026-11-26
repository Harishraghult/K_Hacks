"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { useSession } from "@/lib/session";
import { Spinner } from "./kit";

const NAV = [
  { href: "/", label: "Home", icon: "⌂" },
  { href: "/send", label: "Send money", icon: "↗" },
  { href: "/activity", label: "Activity", icon: "☰" },
  { href: "/account", label: "Account", icon: "◉" },
];

export function Logo({ light = false }: { light?: boolean }) {
  return (
    <div className={`flex items-center gap-2 text-lg font-bold tracking-tight ${light ? "text-white" : "text-zinc-900"}`}>
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500 text-sm font-black text-white">R</span>
      Remit<span className="-ml-2 text-emerald-500">Rail</span>
    </div>
  );
}

/** Signed-in app frame: sidebar + header. Redirects to /login when there is no session. */
export function Shell({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  const { user, wallet, logout, live } = useSession();
  const router = useRouter();
  const path = usePathname();

  useEffect(() => {
    if (user === null) router.replace("/login");
  }, [user, router]);

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50 text-zinc-500">
        <Spinner />
      </div>
    );
  }

  const initials = user.displayName
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="flex min-h-screen bg-zinc-50 text-zinc-900">
      <aside className="sticky top-0 flex h-screen w-60 shrink-0 flex-col border-r border-zinc-200 bg-white px-4 py-5">
        <Logo />
        <nav className="mt-8 space-y-1">
          {NAV.map((n) => {
            const active = n.href === "/" ? path === "/" : path.startsWith(n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${active ? "bg-emerald-50 text-emerald-800" : "text-zinc-600 hover:bg-zinc-100"}`}
              >
                <span className="w-4 text-center opacity-70">{n.icon}</span>
                {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto space-y-3">
          {user.kyc !== "VERIFIED" && (
            <Link href="/verify" className="block rounded-xl bg-amber-50 p-3 text-xs text-amber-900 hover:bg-amber-100">
              <b>Verify your identity</b>
              <br />
              Required before you can add or send money.
            </Link>
          )}
          <div className="flex items-center gap-3 rounded-xl border border-zinc-200 p-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-zinc-900 text-xs font-bold text-white">{initials}</span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold">{user.displayName}</div>
              <div className="truncate text-xs text-zinc-500">@{user.username}</div>
            </div>
          </div>
          <button
            type="button"
            onClick={async () => {
              await logout();
              router.replace("/login");
            }}
            className="w-full rounded-xl px-3 py-2 text-left text-sm text-zinc-500 hover:bg-zinc-100"
          >
            Sign out
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-zinc-200 bg-white/80 px-8 py-4 backdrop-blur">
          <h1 className="text-xl font-semibold">{title}</h1>
          <div className="flex items-center gap-3 text-xs text-zinc-500">
            <span className="flex items-center gap-1.5">
              <span className={`h-2 w-2 rounded-full ${live ? "bg-emerald-500" : "bg-amber-400"}`} />
              {live ? "Live" : "Reconnecting"}
            </span>
            {wallet?.restricted && <span className="rounded-full bg-rose-100 px-2.5 py-0.5 font-semibold text-rose-800">Account restricted</span>}
            {actions}
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-8 py-6">{children}</main>
      </div>
    </div>
  );
}
