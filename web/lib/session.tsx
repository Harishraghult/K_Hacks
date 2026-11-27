"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { ANCHOR_URL, ApiError, api, type AssetCode, type Country, type FiatCode, type TransferView } from "./api";

export interface Profile {
  username: string;
  displayName: string;
  country: Country;
  sendCurrency: FiatCode;
  walletAddress: string;
  walletExplorer: string;
  walletStatus: "PROVISIONING" | "READY" | "FAILED";
  walletError: string | null;
  kyc: "VERIFIED" | "NOT_VERIFIED";
  restricted: boolean;
  memberSince: number;
}
export interface Wallet extends Profile {
  balances: Record<AssetCode, { balance: string; enabled: boolean; frozen: boolean }> | null;
  bank: { currency: FiatCode; balance: string } | null;
}

interface SessionValue {
  user?: Profile | null; // undefined = loading, null = signed out
  wallet?: Wallet;
  transfers: TransferView[];
  setUser: (p: Profile | null) => void;
  refreshWallet: () => Promise<void>;
  refreshTransfers: () => Promise<void>;
  logout: () => Promise<void>;
  live: boolean;
}

const Ctx = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Profile | null | undefined>(undefined);
  const [wallet, setWallet] = useState<Wallet>();
  const [transfers, setTransfers] = useState<TransferView[]>([]);
  const [live, setLive] = useState(false);
  const walletTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    api<Profile | null>("/auth/me")
      .then((p) => setUser(p ?? null))
      .catch((e) => setUser(e instanceof ApiError && e.status === 401 ? null : null));
  }, []);

  const refreshWallet = useCallback(async () => {
    try {
      const w = await api<Wallet>("/me/wallet");
      setWallet(w);
      setUser((u) => (u ? { ...u, ...w } : u));
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setUser(null);
    }
  }, []);

  const refreshTransfers = useCallback(async () => {
    try {
      setTransfers(await api<TransferView[]>("/me/transfers"));
    } catch {
      /* handled by wallet refresh */
    }
  }, []);

  const signedIn = !!user;
  useEffect(() => {
    if (!signedIn) return;
    refreshWallet();
    refreshTransfers();
    const es = new EventSource(`${ANCHOR_URL}/me/events`, { withCredentials: true });
    es.addEventListener("hello", () => {
      setLive(true);
      refreshTransfers();
      refreshWallet();
    });
    es.addEventListener("transfer", (ev) => {
      const t = JSON.parse((ev as MessageEvent).data) as TransferView;
      setTransfers((prev) => [t, ...prev.filter((x) => x.id !== t.id)].sort((a, b) => b.createdAt - a.createdAt));
      clearTimeout(walletTimer.current);
      walletTimer.current = setTimeout(refreshWallet, 800);
    });
    es.addEventListener("senders", () => {
      clearTimeout(walletTimer.current);
      walletTimer.current = setTimeout(refreshWallet, 800);
    });
    es.onerror = () => setLive(false);
    return () => es.close();
  }, [signedIn, refreshWallet, refreshTransfers]);

  // While the wallet is being created on-chain, poll until it's ready.
  useEffect(() => {
    if (user?.walletStatus !== "PROVISIONING") return;
    const t = setInterval(refreshWallet, 2500);
    return () => clearInterval(t);
  }, [user?.walletStatus, refreshWallet]);

  const logout = useCallback(async () => {
    await api("/auth/logout", { body: {} }).catch(() => undefined);
    setUser(null);
    setWallet(undefined);
    setTransfers([]);
  }, []);

  return (
    <Ctx.Provider value={{ user, wallet, transfers, setUser, refreshWallet, refreshTransfers, logout, live }}>{children}</Ctx.Provider>
  );
}

export function useSession() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSession outside SessionProvider");
  return v;
}
