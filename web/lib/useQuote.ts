"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { AmountError, parseAmount } from "@remit/shared/money";
import { api, type Quote } from "./api";

/** Live quote for amount/asset: debounced, single-flight, auto-refreshed when the 30s hold expires. */
export function useQuote(asset: "tAED" | "tUSDC", amount: string, opts: { paused?: boolean } = {}) {
  const [quote, setQuote] = useState<Quote>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [secsLeft, setSecsLeft] = useState(0);
  const seq = useRef(0);

  let amountError: string | undefined;
  try {
    parseAmount(amount);
  } catch (e) {
    amountError = e instanceof AmountError ? e.message : "Invalid amount";
  }

  const refresh = useCallback(async () => {
    if (amountError) {
      setQuote(undefined);
      return undefined;
    }
    const id = ++seq.current;
    setLoading(true);
    try {
      const q = await api<Quote>(`/quote?sendAsset=${asset}&sendAmount=${encodeURIComponent(amount)}&destAsset=tINR`);
      if (id !== seq.current) return undefined;
      setQuote(q);
      setError(undefined);
      return q;
    } catch (e) {
      if (id !== seq.current) return undefined;
      setQuote(undefined);
      setError((e as Error).message);
      return undefined;
    } finally {
      if (id === seq.current) setLoading(false);
    }
  }, [asset, amount, amountError]);

  useEffect(() => {
    const t = setTimeout(refresh, 350);
    return () => clearTimeout(t);
  }, [refresh]);

  useEffect(() => {
    if (!quote) {
      setSecsLeft(0);
      return;
    }
    const calc = () => {
      const maxSecs = Math.round((quote.expiresAt - quote.createdAt) / 1000);
      return Math.min(maxSecs, Math.max(0, Math.ceil((quote.expiresAt - Date.now()) / 1000)));
    };
    setSecsLeft(calc());
    const t = setInterval(() => {
      const s = calc();
      setSecsLeft((prev) => (prev !== s ? s : prev));
    }, 1000);
    return () => clearInterval(t);
  }, [quote]);

  useEffect(() => {
    if (quote && secsLeft === 0 && !loading && !opts.paused) refresh();
  }, [secsLeft, quote, loading, opts.paused, refresh]);

  return { quote, error, loading, secsLeft, amountError, refresh };
}
