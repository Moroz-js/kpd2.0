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

/**
 * Сохраняет/восстанавливает scrollTop/scrollLeft контейнера.
 * Без MutationObserver: с виртуализацией он зацикливает restore
 * («скролл сам возвращается» при фильтрах/группировке).
 */
export function usePersistedScroll(
  ref: React.RefObject<HTMLElement | null>,
  key: string
) {
  const storageKey = useStorageKey(`scroll:${key}`);

  React.useEffect(() => {
    let element: HTMLElement | null = null;
    let bindTimeout: ReturnType<typeof setTimeout> | undefined;
    let saveTimeout: ReturnType<typeof setTimeout> | undefined;
    let restoreTimeout: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    let restoring = false;
    let userTookOver = false;
    let restoreAttempts = 0;
    const bindDeadline = Date.now() + 10_000;
    const MAX_RESTORE_ATTEMPTS = 24; // ~1.2s при шаге 50ms

    const readStored = (): { top?: number; left?: number } | null => {
      try {
        const raw = window.localStorage.getItem(storageKey);
        return raw ? deserialize(raw) : null;
      } catch {
        return null;
      }
    };

    const saveAlways = (target = element) => {
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

    const stopRestore = () => {
      restoring = false;
      clearTimeout(restoreTimeout);
      restoreTimeout = undefined;
    };

    const tryRestore = () => {
      if (disposed || userTookOver || !element) {
        stopRestore();
        return;
      }
      const stored = readStored();
      const top = Math.max(0, stored?.top ?? 0);
      const left = Math.max(0, stored?.left ?? 0);
      if (top === 0 && left === 0) {
        stopRestore();
        return;
      }

      restoring = true;
      element.scrollTo({ top, left, behavior: "auto" });

      const maxTop = Math.max(0, element.scrollHeight - element.clientHeight);
      const maxLeft = Math.max(0, element.scrollWidth - element.clientWidth);
      const reached =
        Math.abs(element.scrollTop - Math.min(top, maxTop)) <= 2 &&
        Math.abs(element.scrollLeft - Math.min(left, maxLeft)) <= 2;
      const contentTallEnough = maxTop + 1 >= top;

      restoreAttempts += 1;
      if (
        reached ||
        (contentTallEnough && restoreAttempts >= 3) ||
        restoreAttempts >= MAX_RESTORE_ATTEMPTS
      ) {
        stopRestore();
        return;
      }
      restoreTimeout = setTimeout(tryRestore, 50);
    };

    const onUserInteract = () => {
      if (!userTookOver) {
        userTookOver = true;
        stopRestore();
      }
    };

    const onScroll = () => {
      if (restoring) return;
      clearTimeout(saveTimeout);
      saveTimeout = setTimeout(() => saveAlways(), 120);
    };

    const bind = () => {
      if (disposed) return;
      element = ref.current;
      if (!element) {
        if (Date.now() < bindDeadline) bindTimeout = setTimeout(bind, 50);
        return;
      }

      element.addEventListener("scroll", onScroll, { passive: true });
      element.addEventListener("wheel", onUserInteract, { passive: true });
      element.addEventListener("pointerdown", onUserInteract, { passive: true });
      element.addEventListener("touchstart", onUserInteract, { passive: true });
      element.addEventListener("keydown", onUserInteract);

      const stored = readStored();
      if (stored && ((stored.top ?? 0) > 0 || (stored.left ?? 0) > 0)) {
        // Даём фильтрам/данным кадр на восстановление из localStorage
        requestAnimationFrame(() => {
          if (!disposed && !userTookOver) tryRestore();
        });
      }
    };

    bind();
    const onPageHide = () => saveAlways();
    window.addEventListener("pagehide", onPageHide);

    return () => {
      disposed = true;
      clearTimeout(bindTimeout);
      clearTimeout(saveTimeout);
      clearTimeout(restoreTimeout);
      // Всегда сохраняем позицию при уходе (даже если restore ещё шёл)
      if (element) saveAlways(element);
      element?.removeEventListener("scroll", onScroll);
      element?.removeEventListener("wheel", onUserInteract);
      element?.removeEventListener("pointerdown", onUserInteract);
      element?.removeEventListener("touchstart", onUserInteract);
      element?.removeEventListener("keydown", onUserInteract);
      window.removeEventListener("pagehide", onPageHide);
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
