"use client";
import { useEffect, useState, type ReactNode } from "react";

/** The demo is live, clock-driven UI: render it only in the browser, never at prerender time. */
export function ClientOnly({ children, fallback }: { children: ReactNode; fallback: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted ? children : fallback;
}
