"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

type ArrayFilter = {
  stateKey: string;
  param: string;
  kind: "array";
  value: string[];
  defaultValue: string[];
  setValue: React.Dispatch<React.SetStateAction<string[]>>;
};

type BooleanFilter = {
  stateKey: string;
  param: string;
  kind: "boolean";
  value: boolean;
  defaultValue: boolean;
  setValue: React.Dispatch<React.SetStateAction<boolean>>;
};

type StringFilter = {
  stateKey: string;
  param: string;
  kind: "string";
  value: string;
  defaultValue: string;
  setValue: React.Dispatch<React.SetStateAction<string>>;
};

export type UrlSyncedFilter = ArrayFilter | BooleanFilter | StringFilter;

/**
 * Синхронизирует фильтры таблицы с URL, не затрагивая сортировку, группировку
 * и остальные параметры страницы. Наличие любого параметра фильтра в URL
 * делает URL источником истины для всего набора фильтров.
 */
export function useUrlSyncedFilters(filters: UrlSyncedFilter[]) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const search = searchParams.toString();
  const filtersRef = React.useRef(filters);
  const initialSyncRef = React.useRef(true);
  // Храним последнюю query-строку, которую мы САМИ записали в URL через
  // syncUrl(). Эффект восстановления ниже реагирует на любое изменение
  // search (включая то, что вызвано нашей же router.replace), поэтому без
  // этой метки он не может отличить «URL поменялся снаружи (первая загрузка,
  // назад/вперёд в браузере, ручная правка адреса)» от «URL просто отразил
  // текущее состояние фильтров, которое мы и так знаем». Во втором случае
  // ничего восстанавливать не нужно — иначе фильтр, отсутствующий в URL
  // только потому, что он сейчас пустой (например, год сняли явно), будет
  // насильно возвращён к дефолту при каждом собственном обновлении URL.
  const lastSyncedSearchRef = React.useRef<string | null>(null);
  const hasUrlFilters = filters.some((filter) => searchParams.has(filter.param));
  const stateSignature = JSON.stringify(
    filters.map((filter) => [filter.param, filter.value])
  );

  React.useEffect(() => {
    filtersRef.current = filters;
  }, [filters]);

  React.useEffect(() => {
    // Этот же search мы только что сами записали в URL — не «восстанавливаем»
    // из него состояние, оно и так актуально (см. комментарий у ref выше).
    if (lastSyncedSearchRef.current !== null && search === lastSyncedSearchRef.current) {
      return;
    }
    if (hasUrlFilters) {
      for (const filter of filtersRef.current) {
        if (filter.kind === "array") {
          filter.setValue(
            searchParams.has(filter.param)
              ? searchParams.getAll(filter.param).filter(Boolean)
              : [...filter.defaultValue]
          );
        } else if (filter.kind === "boolean") {
          filter.setValue(
            searchParams.has(filter.param)
              ? searchParams.get(filter.param) === "1"
              : filter.defaultValue
          );
        } else {
          filter.setValue(
            searchParams.has(filter.param)
              ? searchParams.get(filter.param) ?? filter.defaultValue
              : filter.defaultValue
          );
        }
      }
    }
  }, [hasUrlFilters, search, searchParams]);

  React.useEffect(() => {
    const syncUrl = () => {
      const next = new URLSearchParams(search);
      for (const filter of filtersRef.current) {
        next.delete(filter.param);
        if (filter.kind === "array") {
          for (const value of filter.value) next.append(filter.param, value);
        } else if (filter.kind === "boolean" && filter.value) {
          next.set(filter.param, "1");
        } else if (filter.kind === "string" && filter.value) {
          next.set(filter.param, filter.value);
        }
      }

      const nextSearch = next.toString();
      // Запоминаем строку как «свою» ДО навигации: даже если replace ещё не
      // применился, последующий рендер с новым search должен узнать в нём
      // собственную запись и не откатывать фильтры к дефолтам.
      lastSyncedSearchRef.current = nextSearch;
      if (nextSearch !== search) {
        router.replace(nextSearch ? `${pathname}?${nextSearch}` : pathname, {
          scroll: false,
        });
      }
    };

    if (initialSyncRef.current) {
      // Флаг переводим в false только когда кадр реально выполнился, а не при
      // планировании: в дев-режиме (React Strict Mode) эффект монтирования
      // вызывается дважды подряд синхронно, до того как применится setState
      // из эффекта восстановления фильтров из URL. Если сбросить флаг сразу
      // при планировании, второй (синхронный) вызов этого же эффекта уйдёт
      // в synchronous-ветку и перезапишет URL по ещё не обновлённым (пустым)
      // значениям фильтров, затирая часть параметров прямо при открытии ссылки.
      const frame = window.requestAnimationFrame(() => {
        initialSyncRef.current = false;
        syncUrl();
      });
      return () => window.cancelAnimationFrame(frame);
    }

    syncUrl();
  }, [pathname, router, search, stateSignature]);

  const restorePersisted = React.useCallback(
    (stored: object) => {
      if (hasUrlFilters) return;

      const values = stored as Record<string, unknown>;
      for (const filter of filtersRef.current) {
        const value = values[filter.stateKey];
        if (filter.kind === "array" && Array.isArray(value)) {
          filter.setValue(value.filter((item): item is string => typeof item === "string"));
        } else if (filter.kind === "boolean" && typeof value === "boolean") {
          filter.setValue(value);
        } else if (filter.kind === "string" && typeof value === "string") {
          filter.setValue(value);
        }
      }
    },
    [hasUrlFilters]
  );

  return { restorePersisted };
}
