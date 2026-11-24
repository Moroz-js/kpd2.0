"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { usePersistedInterfaceState } from "@/components/PersistedInterfaceState";
import {
  cashflowHref, defaultCashflowView, hasCashflowParams, localCashflowFields, readCashflowView,
  type CashflowView,
} from "./cashflow-view";

export function useCashflowView() {
  const params = useSearchParams();
  const [defaults] = useState(() => defaultCashflowView());
  const legacy = useRef(defaults);
  const [local, setLocal] = useState<ReturnType<typeof localCashflowFields> | null>(null);

  usePersistedInterfaceState("cashflow", local ?? localCashflowFields(defaults), (stored) => {
    legacy.current = readCashflowView(new URLSearchParams(), stored);
    setLocal(localCashflowFields(legacy.current));
  });
  useEffect(() => {
    // Wait for both the scoped local restore and Next's native history integration.
    // No restore callback is issued for missing/blocked storage.
    const entry = new URL(window.location.href);
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      const restored = legacy.current;
      setLocal((current) => current ?? localCashflowFields(restored));
      if (entry.href === window.location.href && !hasCashflowParams(entry.searchParams)) {
        // Pin even the default months so a copied link is independent of the recipient's storage.
        window.history.replaceState(null, "", cashflowHref(entry, restored));
      }
    });
    return () => { active = false; };
  }, [defaults]);

  function update(patch: Partial<CashflowView>) {
    // Derive from the actual entry, not a render which may predate another click or navigation.
    const url = new URL(window.location.href);
    const previous = readCashflowView(url.searchParams, local);
    const next = { ...previous, ...patch };
    const before = cashflowHref(url, previous);
    const after = cashflowHref(url, next);
    if (before === after) return;
    if (!hasCashflowParams(url.searchParams)) window.history.replaceState(null, "", before);
    window.history.pushState(null, "", after);
    setLocal(localCashflowFields(next));
  }

  // Next subscribes to native history. Back/forward only reads this entry, never writes it back.
  const view = hasCashflowParams(params) || local ? readCashflowView(params, local) : null;
  return { view, update };
}
