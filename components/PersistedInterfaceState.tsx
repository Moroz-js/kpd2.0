"use client";

import * as React from "react";

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
  key: string,
  options: {
    enabled?: boolean;
    signature?: unknown;
  } = {}
) {
  const { enabled = true, signature: signatureValue = "" } = options;
  const signature = serialize(signatureValue);
  const storageKey = useStorageKey(`scroll:${key}`);

  React.useEffect(() => {
    if (!enabled) return;
    const signatureKey = signature || "__default__";
    type ScrollPosition = { top: number; left: number };
    type StoredScroll = {
      positions: Record<string, ScrollPosition>;
    };

    let element: HTMLElement | null = null;
    let bindTimeout: ReturnType<typeof setTimeout> | undefined;
    let saveTimeout: ReturnType<typeof setTimeout> | undefined;
    let pollTimeout: ReturnType<typeof setTimeout> | undefined;
    let resizeObserver: ResizeObserver | undefined;
    let disposed = false;
    let restoring = false;
    let targetReachedAt: number | null = null;
    let userGestureUntil = 0;
    let pointerDraggingScrollbar = false;
    let touchScrolling = false;
    let pollingPaused = false;
    const bindDeadline = Date.now() + 10_000;
    const restoreDeadline = Date.now() + 5_000;

    const normalizePosition = (value: unknown): ScrollPosition => {
      const item =
        value && typeof value === "object"
          ? (value as { top?: unknown; left?: unknown })
          : {};
      return {
        top:
          typeof item.top === "number" && Number.isFinite(item.top)
            ? Math.max(0, item.top)
            : 0,
        left:
          typeof item.left === "number" && Number.isFinite(item.left)
            ? Math.max(0, item.left)
            : 0,
      };
    };

    const readStore = (): StoredScroll => {
      try {
        const raw = window.localStorage.getItem(storageKey);
        if (!raw) return { positions: {} };
        const parsed = deserialize<{
          positions?: Record<string, unknown>;
          top?: number;
          left?: number;
          signature?: string;
        }>(raw);
        if (parsed.positions && typeof parsed.positions === "object") {
          return {
            positions: Object.fromEntries(
              Object.entries(parsed.positions).map(([itemKey, value]) => [
                itemKey,
                normalizePosition(value),
              ])
            ),
          };
        }
        // Миграция формата v1 с одной позицией.
        return {
          positions: {
            [parsed.signature || "__legacy__"]: normalizePosition(parsed),
          },
        };
      } catch {
        return { positions: {} };
      }
    };

    const readTarget = (): ScrollPosition => {
      const positions = readStore().positions;
      return (
        positions[signatureKey] ??
        positions.__legacy__ ??
        { top: 0, left: 0 }
      );
    };

    const writePosition = (position: ScrollPosition) => {
      try {
        const store = readStore();
        store.positions[signatureKey] = normalizePosition(position);
        window.localStorage.setItem(storageKey, serialize(store));
      } catch {
        // Storage can be disabled or full.
      }
    };

    const target = readTarget();
    let lastConfirmedPosition = target;

    const stopRestore = () => {
      restoring = false;
      clearTimeout(pollTimeout);
      pollTimeout = undefined;
      resizeObserver?.disconnect();
      resizeObserver = undefined;
      targetReachedAt = null;
      pollingPaused = false;
    };

    const captureConfirmedPosition = () => {
      if (!element) return;
      lastConfirmedPosition = {
        top: Math.max(0, element.scrollTop),
        left: Math.max(0, element.scrollLeft),
      };
    };

    const tryRestore = () => {
      if (disposed || !element) {
        stopRestore();
        return;
      }
      const { top, left } = target;
      if (top <= 0 && left <= 0) {
        stopRestore();
        return;
      }

      restoring = true;
      const maxTop = Math.max(0, element.scrollHeight - element.clientHeight);
      const maxLeft = Math.max(0, element.scrollWidth - element.clientWidth);
      const canReach = maxTop + 1 >= top && maxLeft + 1 >= left;
      const nextTop = Math.min(top, maxTop);
      const nextLeft = Math.min(left, maxLeft);
      element.scrollTo({ top: nextTop, left: nextLeft, behavior: "auto" });
      const atTarget =
        Math.abs(element.scrollTop - top) <= 2 &&
        Math.abs(element.scrollLeft - left) <= 2;

      if (canReach && atTarget) {
        if (targetReachedAt === null) targetReachedAt = Date.now();
        // Виртуализатор может перемерить строки и временно вернуть scrollTop в 0.
        // Считаем restore завершённым только после устойчивой позиции.
        if (
          Date.now() >= restoreDeadline ||
          Date.now() - targetReachedAt >= 600
        ) {
          stopRestore();
        }
        return;
      }
      targetReachedAt = null;

      if (Date.now() >= restoreDeadline) {
        // Прекращаем активный polling, но оставляем ResizeObserver: поздняя
        // revalidation снова вызовет restore, когда таблица вырастет.
        pollingPaused = true;
        clearTimeout(pollTimeout);
        pollTimeout = undefined;
      }
    };

    const beginUserScroll = () => {
      userGestureUntil = performance.now() + 1_000;
      if (restoring) stopRestore();
    };

    const onWheel = () => beginUserScroll();
    const onTouchStart = () => {
      touchScrolling = true;
      beginUserScroll();
    };
    const onTouchEnd = () => {
      touchScrolling = false;
      userGestureUntil = performance.now() + 250;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        [
          "ArrowDown",
          "ArrowUp",
          "ArrowLeft",
          "ArrowRight",
          "PageDown",
          "PageUp",
          "Home",
          "End",
          " ",
        ].includes(event.key)
      ) {
        beginUserScroll();
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!element) return;
      const rect = element.getBoundingClientRect();
      const onVerticalScrollbar =
        element.offsetWidth > element.clientWidth &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom &&
        event.clientX >= rect.left + element.clientWidth;
      const onHorizontalScrollbar =
        element.offsetHeight > element.clientHeight &&
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top + element.clientHeight;
      if (onVerticalScrollbar || onHorizontalScrollbar) {
        pointerDraggingScrollbar = true;
        beginUserScroll();
      }
    };
    const onPointerUp = () => {
      if (!pointerDraggingScrollbar) return;
      pointerDraggingScrollbar = false;
      userGestureUntil = performance.now() + 250;
    };

    const onScroll = () => {
      const confirmedUserScroll =
        pointerDraggingScrollbar ||
        touchScrolling ||
        performance.now() <= userGestureUntil;
      if (restoring) {
        if (confirmedUserScroll) {
          stopRestore();
          captureConfirmedPosition();
        }
        return;
      }
      if (!confirmedUserScroll) return;
      captureConfirmedPosition();
      clearTimeout(saveTimeout);
      saveTimeout = setTimeout(() => writePosition(lastConfirmedPosition), 120);
    };

    const startRestore = () => {
      if (target.top <= 0 && target.left <= 0) {
        element?.scrollTo({ top: 0, left: 0, behavior: "auto" });
        return;
      }
      restoring = true;
      resizeObserver = new ResizeObserver(() => {
        if (!restoring || disposed) return;
        tryRestore();
      });
      if (element) {
        resizeObserver.observe(element);
        if (element.firstElementChild instanceof HTMLElement) {
          resizeObserver.observe(element.firstElementChild);
        }
      }
      const poll = () => {
        if (!restoring || disposed || pollingPaused) return;
        tryRestore();
        if (restoring && !pollingPaused) pollTimeout = setTimeout(poll, 100);
      };
      requestAnimationFrame(() => {
        tryRestore();
        if (restoring && !pollingPaused) pollTimeout = setTimeout(poll, 100);
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
      element.addEventListener("wheel", onWheel, { passive: true });
      element.addEventListener("touchstart", onTouchStart, { passive: true });
      element.addEventListener("touchend", onTouchEnd, { passive: true });
      element.addEventListener("keydown", onKeyDown);
      window.addEventListener("pointerdown", onPointerDown, true);
      window.addEventListener("pointerup", onPointerUp, true);

      startRestore();
    };

    bind();
    const onPageHide = () => writePosition(lastConfirmedPosition);
    window.addEventListener("pagehide", onPageHide);

    return () => {
      writePosition(lastConfirmedPosition);
      disposed = true;
      clearTimeout(bindTimeout);
      clearTimeout(pollTimeout);
      clearTimeout(saveTimeout);
      stopRestore();
      element?.removeEventListener("scroll", onScroll);
      element?.removeEventListener("wheel", onWheel);
      element?.removeEventListener("touchstart", onTouchStart);
      element?.removeEventListener("touchend", onTouchEnd);
      element?.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("pointerup", onPointerUp, true);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [ref, storageKey, enabled, signature]);
}

export function PersistedDashboardMain({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto overflow-x-hidden bg-neutral-50">
      <div className="h-full p-6">{children}</div>
    </main>
  );
}
