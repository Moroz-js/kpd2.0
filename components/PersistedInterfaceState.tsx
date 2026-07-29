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
 *
 * Важно для виртуализированных таблиц:
 * - не считать «достигли цели», пока scrollHeight ещё мал (иначе 0 = «успех»);
 * - не перезаписывать сохранённую позицию нулём при размонтировании во время restore;
 * - ResizeObserver только пока идёт restore, отключается при жесте пользователя.
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
    let pollTimeout: ReturnType<typeof setTimeout> | undefined;
    let resizeObserver: ResizeObserver | undefined;
    let disposed = false;
    let restoring = false;
    let userTookOver = false;
    const bindDeadline = Date.now() + 10_000;
    const restoreDeadline = Date.now() + 20_000;

    const readStored = (): { top: number; left: number } => {
      try {
        const raw = window.localStorage.getItem(storageKey);
        if (!raw) return { top: 0, left: 0 };
        const parsed = deserialize<{ top?: number; left?: number }>(raw);
        return {
          top: Math.max(0, parsed.top ?? 0),
          left: Math.max(0, parsed.left ?? 0),
        };
      } catch {
        return { top: 0, left: 0 };
      }
    };

    let stored = readStored();

    const writeStored = (top: number, left: number) => {
      stored = { top, left };
      try {
        window.localStorage.setItem(storageKey, serialize(stored));
      } catch {
        // Storage can be disabled or full.
      }
    };

    const stopRestore = () => {
      restoring = false;
      clearTimeout(pollTimeout);
      pollTimeout = undefined;
      resizeObserver?.disconnect();
      resizeObserver = undefined;
    };

    const saveFromElement = (reason: "scroll" | "unmount" | "pagehide") => {
      if (!element) return;
      const top = element.scrollTop;
      const left = element.scrollLeft;

      // Не затираем валидную позицию нулём, пока контент не готов / идёт restore
      if (reason !== "scroll") {
        if (restoring && !userTookOver) return;
        if (
          !userTookOver &&
          top <= 1 &&
          left <= 1 &&
          (stored.top > 1 || stored.left > 1)
        ) {
          return;
        }
      }
      if (restoring) return;

      writeStored(top, left);
    };

    const tryRestore = () => {
      if (disposed || userTookOver || !element) {
        stopRestore();
        return;
      }
      const { top, left } = stored;
      if (top <= 0 && left <= 0) {
        stopRestore();
        return;
      }

      restoring = true;
      element.scrollTo({ top, left, behavior: "auto" });

      const maxTop = Math.max(0, element.scrollHeight - element.clientHeight);
      const maxLeft = Math.max(0, element.scrollWidth - element.clientWidth);
      const canReach = maxTop + 1 >= top && maxLeft + 1 >= left;
      const atTarget =
        Math.abs(element.scrollTop - top) <= 2 &&
        Math.abs(element.scrollLeft - left) <= 2;

      // Пока контент ниже цели — ждём рост scrollHeight (не считаем clamp=0 успехом)
      if (canReach && atTarget) {
        stopRestore();
        return;
      }
      if (Date.now() >= restoreDeadline) {
        stopRestore();
      }
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
      saveTimeout = setTimeout(() => saveFromElement("scroll"), 120);
    };

    const startRestore = () => {
      if (stored.top <= 0 && stored.left <= 0) return;
      restoring = true;
      resizeObserver = new ResizeObserver(() => {
        if (!restoring || userTookOver || disposed) return;
        tryRestore();
      });
      if (element) {
        resizeObserver.observe(element);
        if (element.firstElementChild instanceof HTMLElement) {
          resizeObserver.observe(element.firstElementChild);
        }
      }
      const poll = () => {
        if (!restoring || disposed || userTookOver) return;
        tryRestore();
        if (restoring) pollTimeout = setTimeout(poll, 100);
      };
      requestAnimationFrame(() => {
        tryRestore();
        if (restoring) pollTimeout = setTimeout(poll, 100);
      });
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

      startRestore();
    };

    bind();
    const onPageHide = () => saveFromElement("pagehide");
    window.addEventListener("pagehide", onPageHide);

    return () => {
      disposed = true;
      clearTimeout(bindTimeout);
      clearTimeout(saveTimeout);
      clearTimeout(pollTimeout);
      saveFromElement("unmount");
      stopRestore();
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
