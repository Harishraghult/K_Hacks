"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ANCHOR_URL, api, type AppConfig, type Health, type Sender, type TransferView } from "./api";

/** Live app state: transfers + senders kept fresh over SSE, with refetch on (re)connect. */
export function useLive() {
  const [transfers, setTransfers] = useState<Record<string, TransferView>>({});
  const [senders, setSenders] = useState<Sender[]>([]);
  const [config, setConfig] = useState<AppConfig>();
  const [health, setHealth] = useState<Health>();
  const [connected, setConnected] = useState(false);
  const [offline, setOffline] = useState<string>();
  const [unmatchedTick, setUnmatchedTick] = useState(0);
  const sendersTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const refreshSenders = useCallback(async () => {
    try {
      setSenders(await api<Sender[]>("/senders"));
      setOffline(undefined);
    } catch (e) {
      setOffline((e as Error).message);
    }
  }, []);

  const refreshTransfers = useCallback(async () => {
    try {
      const list = await api<TransferView[]>("/transfers?limit=60");
      setTransfers(Object.fromEntries(list.map((t) => [t.id, t])));
    } catch {
      /* surfaced by senders/health */
    }
  }, []);

  const refreshHealth = useCallback(async () => {
    try {
      setHealth(await api<Health>("/health"));
    } catch (e) {
      setOffline((e as Error).message);
    }
  }, []);

  // Debounced: a batch of 10 transfers should not trigger 10 balance reloads.
  const scheduleSenders = useCallback(() => {
    clearTimeout(sendersTimer.current);
    sendersTimer.current = setTimeout(refreshSenders, 600);
  }, [refreshSenders]);

  useEffect(() => {
    api<AppConfig>("/config").then(setConfig).catch(() => undefined);
    refreshHealth();
    const h = setInterval(refreshHealth, 10_000);

    const es = new EventSource(`${ANCHOR_URL}/events`);
    es.addEventListener("hello", () => {
      // (Re)connected: anything could have happened while we were away.
      setConnected(true);
      refreshTransfers();
      refreshSenders();
    });
    es.addEventListener("transfer", (ev) => {
      const t = JSON.parse((ev as MessageEvent).data) as TransferView;
      setTransfers((prev) => ({ ...prev, [t.id]: t }));
      if (["SETTLED_ON_CHAIN", "REFUNDED", "ON_CHAIN_FAILED", "PAYOUT_COMPLETE"].includes(t.status)) scheduleSenders();
    });
    es.addEventListener("senders", scheduleSenders);
    es.addEventListener("unmatched", () => setUnmatchedTick((x) => x + 1));
    es.onerror = () => setConnected(false); // EventSource retries automatically
    return () => {
      es.close();
      clearInterval(h);
    };
  }, [refreshHealth, refreshSenders, refreshTransfers, scheduleSenders]);

  const upsert = useCallback((t: TransferView) => setTransfers((prev) => ({ ...prev, [t.id]: t })), []);

  return { transfers, senders, config, health, connected, offline, unmatchedTick, refreshSenders, refreshHealth, upsert };
}

export function relTime(ms: number) {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
}
