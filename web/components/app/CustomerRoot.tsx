"use client";
import type { ReactNode } from "react";
import { ClientOnly } from "@/components/ClientOnly";
import { SessionProvider } from "@/lib/session";

/** One session + one live connection shared by every customer page. */
export function CustomerRoot({ children }: { children: ReactNode }) {
  return (
    <ClientOnly fallback={<div className="min-h-screen bg-zinc-50" />}>
      <SessionProvider>{children}</SessionProvider>
    </ClientOnly>
  );
}
