"use client";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

/** "laptop" = compact layout for ~1280–1600px screens; "projector" = roomy layout for big screens. */
export type ViewPref = "auto" | "laptop" | "projector";

const ViewCtx = createContext<{ compact: boolean; pref: ViewPref; setPref: (p: ViewPref) => void }>({
  compact: false,
  pref: "auto",
  setPref: () => undefined,
});

export function ViewProvider({ children }: { children: ReactNode }) {
  const [pref, setPrefState] = useState<ViewPref>("auto");
  const [small, setSmall] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("viewPref") as ViewPref | null;
    if (saved === "laptop" || saved === "projector") setPrefState(saved);
    const check = () => setSmall(window.innerWidth < 1700 || window.innerHeight < 900);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  const setPref = (p: ViewPref) => {
    setPrefState(p);
    localStorage.setItem("viewPref", p);
  };
  const compact = pref === "laptop" || (pref === "auto" && small);
  return <ViewCtx.Provider value={{ compact, pref, setPref }}>{children}</ViewCtx.Provider>;
}

export const useView = () => useContext(ViewCtx);
