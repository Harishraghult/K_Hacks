import { AED_PER_USD, FALLBACK_INR_PER_USD } from "./constants";

export interface FxSnapshot {
  inrPerUsd: string;
  aedPerUsd: string;
  asOf: string; // date of the published rate
  source: "frankfurter" | "fallback";
}

const URLS = [
  "https://api.frankfurter.dev/v1/latest?from=USD&to=INR",
  "https://api.frankfurter.app/latest?from=USD&to=INR",
];

let cache: { at: number; snap: FxSnapshot } | undefined;
const CACHE_MS = 10 * 60 * 1000;

export async function getFx(): Promise<FxSnapshot> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.snap;
  for (const url of URLS) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5000), redirect: "follow" });
      if (!res.ok) continue;
      const text = await res.text();
      // Pull the rate out of the raw text so it never passes through a JS float.
      const m = text.match(/"INR"\s*:\s*([0-9.]+)/);
      const date = text.match(/"date"\s*:\s*"([^"]+)"/)?.[1];
      if (!m) continue;
      const snap: FxSnapshot = { inrPerUsd: m[1], aedPerUsd: AED_PER_USD, asOf: date ?? "unknown", source: "frankfurter" };
      cache = { at: Date.now(), snap };
      return snap;
    } catch {
      /* try next */
    }
  }
  return { inrPerUsd: FALLBACK_INR_PER_USD, aedPerUsd: AED_PER_USD, asOf: "fallback (hardcoded)", source: "fallback" };
}
