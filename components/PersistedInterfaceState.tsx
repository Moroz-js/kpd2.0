"use client";

import * as React from "react";
import { usePathname } from "next/navigation";

const STORAGE_PREFIX = "kpd:interface-state:v1";

const PersistedInterfaceStateContext = React.createContext<string | null>(null);

export function PersistedInterfaceStateProvider({
  userId,
  children,
}: {
  userId: string;
  children: React.ReactNode;
}) {
  return (
    <PersistedInterfaceStateContext.Provider value={userId}>
      {children}
    </PersistedInterfaceStateContext.Provider>
  );
}

function serialize(value: unknown): string {
  return JSON.stringify(value, (_key, item) =>
    item instanceof Set ? { __kpdType: "Set", values: [...item] } : item
  );
}

function deserialize<T>(value: string): T {
  return JSON.parse(value, (_key, item) => {
    if (
      item &&
      typeof item === "object" &&
      item.__kpdType === "Set" &&
      Array.isArray(item.values)
    ) {
      return new Set(item.values);
    }
    return item;
  }) as T;
}

function useStorageKey(key: string): string {
  const userId = React.useContext(PersistedInterfaceStateContext);
  if (!userId) {
    throw new Error(
      "Persisted interface state must be used inside PersistedInterfaceStateProvider"
    );
  }
  return `${STORAGE_PREFIX}:${userId}:${key}`;
}

/**
 * Persists a group of existing component states without forcing the page to
 * change how those states are owned.
 */
export function usePersistedInterfaceState<T extends object>(
  key: string,
  state: T,
  restore: (value: Partial<T>) => void
) {
  const storageKey = useStorageKey(key);
  const restoreRef = React.useRef(restore);
  const serializedState = serialize(state);
  const skipNextSaveRef = React.useRef(true);

  React.useEffect(() => {
    restoreRef.current = restore;
  }, [restore]);

  React.useEffect(() => {
    skipNextSaveRef.current = true;
    try {
      const stored = window.localStorage.getItem(storageKey);
      if (stored) restoreRef.current(deserialize<Partial<T>>(stored));
    } catch {
      // Corrupt or unavailable storage must not break the page.
    }
  }, [storageKey]);

  React.useEffect(() => {
    if (skipNextSaveRef.current) {
      skipNextSaveRef.current = false;
      return;
    }
    try {
      window.localStorage.setItem(storageKey, serializedState);
    } catch {
      // Storage can be disabled or full.
    }
  }, [serializedState, storageKey]);
}

export function usePersistedState<T>(
  key: string,
  initialValue: T | (() => T)
): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [value, setValue] = React.useState(initialValue);
  usePersistedInterfaceState(
    key,
    { value },
    React.useCallback((stored: Partial<{ value: T }>) => {
      if ("value" in stored) setValue(stored.value as T);
    }, [])
  );
  return [value, setValue];
}

export function usePersistedScroll(
  ref: React.RefObject<HTMLElement | null>,
  key: string
) {
  const storageKey = useStorageKey(`scroll:${key}`);

  React.useEffect(() => {
    let element: HTMLElement | null = null;
    let bindTimeout: ReturnType<typeof setTimeout> | undefined;
    let saveTimeout: ReturnType<typeof setTimeout> | undefined;
    let restoreInterval: ReturnType<typeof setInterval> | undefined;
    let mutationObserver: MutationObserver | undefined;
    let resizeObserver: ResizeObserver | undefined;
    let disposed = false;
    let restoring = false;
    let stored: { top?: number; left?: number } | null = null;
    let restoreDeadline = 0;
    const bindDeadline = Date.now() + 30_000;

    const save = (target = element) => {
      if (!target) return;
      try {
        window.localStorage.setItem(
          storageKey,
          serialize({ top: target.scrollTop, left: target.scrollLeft })
        );
      } catch {
        // Storage can be disabled or full.
      }
    };

    const finishRestore = () => {
      restoring = false;
      clearInterval(restoreInterval);
      restoreInterval = undefined;
    };

    const restore = () => {
      if (!element || !stored || disposed) return;
      const top = Math.max(0, stored.top ?? 0);
      const left = Math.max(0, stored.left ?? 0);
      element.scrollTo({ top, left, behavior: "auto" });

      const maxTop = Math.max(0, element.scrollHeight - element.clientHeight);
      const maxLeft = Math.max(0, element.scrollWidth - element.clientWidth);
      const canReachTarget = maxTop + 1 >= top && maxLeft + 1 >= left;
      const targetReached =
        Math.abs(element.scrollTop - Math.min(top, maxTop)) <= 1 &&
        Math.abs(element.scrollLeft - Math.min(left, maxLeft)) <= 1;

      if ((canReachTarget && targetReached) || Date.now() >= restoreDeadline) {
        finishRestore();
      }
    };

    const onScroll = () => {
      if (restoring) return;
      clearTimeout(saveTimeout);
      saveTimeout = setTimeout(save, 120);
    };

    const cancelRestore = () => {
      if (!restoring) return;
      finishRestore();
    };
    const saveCurrent = () => {
      if (!restoring) save();
    };

    const bind = () => {
      if (disposed) return;
      element = ref.current;
      if (!element) {
        if (Date.now() < bindDeadline) bindTimeout = setTimeout(bind, 50);
        return;
      }

      try {
        const raw = window.localStorage.getItem(storageKey);
        stored = raw ? deserialize(raw) : null;
      } catch {
        stored = null;
      }

      element.addEventListener("scroll", onScroll, { passive: true });
      element.addEventListener("wheel", cancelRestore, { passive: true });
      element.addEventListener("pointerdown", cancelRestore, { passive: true });
      element.addEventListener("touchstart", cancelRestore, { passive: true });

      if (stored && ((stored.top ?? 0) > 0 || (stored.left ?? 0) > 0)) {
        restoring = true;
        restoreDeadline = Date.now() + 30_000;
        requestAnimationFrame(restore);
        restoreInterval = setInterval(restore, 250);
        mutationObserver = new MutationObserver(restore);
        mutationObserver.observe(element, { childList: true, subtree: true });
        resizeObserver = new ResizeObserver(restore);
        resizeObserver.observe(element);
        if (element.firstElementChild instanceof HTMLElement) {
          resizeObserver.observe(element.firstElementChild);
        }
      }
    };

    bind();
    window.addEventListener("pagehide", saveCurrent);
    return () => {
      disposed = true;
      clearTimeout(bindTimeout);
      clearTimeout(saveTimeout);
      clearInterval(restoreInterval);
      mutationObserver?.disconnect();
      resizeObserver?.disconnect();
      if (element && !restoring) save(element);
      element?.removeEventListener("scroll", onScroll);
      element?.removeEventListener("wheel", cancelRestore);
      element?.removeEventListener("pointerdown", cancelRestore);
      element?.removeEventListener("touchstart", cancelRestore);
      window.removeEventListener("pagehide", saveCurrent);
    };
  }, [ref, storageKey]);
}

export function PersistedDashboardMain({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const ref = React.useRef<HTMLElement>(null);
  usePersistedScroll(ref, `page:${pathname}`);

  return (
    <main
      ref={ref}
      className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden bg-neutral-50"
    >
      <div className="p-6">{children}</div>
    </main>
  );
}
