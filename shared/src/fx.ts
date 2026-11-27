import { CURRENCY_LIST, type Fiat } from "./corridors";

export interface FxSnapshot {
  /** Units of each currency per 1 USD (strings, never floats). */
  rates: Record<Fiat, string>;
  inrPerUsd: string;
  aedPerUsd: string;
  asOf: string; // date of the published rate
  source: "frankfurter" | "fallback" | "partial";
}

const LIVE = CURRENCY_LIST.filter((c) => c.fiat !== "USD" && !c.pegged).map((c) => c.fiat);
const URLS = [
  `https://api.frankfurter.dev/v1/latest?from=USD&to=${LIVE.join(",")}`,
  `https://api.frankfurter.app/latest?from=USD&to=${LIVE.join(",")}`,
];

let cache: { at: number; snap: FxSnapshot } | undefined;
const CACHE_MS = 10 * 60 * 1000;

function snapshot(live: Partial<Record<Fiat, string>>, asOf: string, source: FxSnapshot["source"]): FxSnapshot {
  const rates = Object.fromEntries(CURRENCY_LIST.map((c) => [c.fiat, c.fiat === "USD" ? "1" : (!c.pegged && live[c.fiat]) || c.fallbackPerUsd])) as Record<Fiat, string>;
  return { rates, inrPerUsd: rates.INR, aedPerUsd: rates.AED, asOf, source };
}

export async function getFx(): Promise<FxSnapshot> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.snap;
  for (const url of URLS) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5000), redirect: "follow" });
      if (!res.ok) continue;
      const text = await res.text();
      // Pull rates out of the raw text so they never pass through a JS float.
      const live: Partial<Record<Fiat, string>> = {};
      for (const f of LIVE) {
        const m = text.match(new RegExp(`"${f}"\\s*:\\s*([0-9.]+)`));
        if (m) live[f] = m[1];
      }
      if (!Object.keys(live).length) continue;
      const date = text.match(/"date"\s*:\s*"([^"]+)"/)?.[1];
      const snap = snapshot(live, date ?? "unknown", Object.keys(live).length === LIVE.length ? "frankfurter" : "partial");
      cache = { at: Date.now(), snap };
      return snap;
    } catch {
      /* try next */
    }
  }
  return snapshot({}, "fallback (hardcoded)", "fallback");
}
