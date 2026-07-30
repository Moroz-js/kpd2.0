"use client";

import * as React from "react";
import { useLayoutEffect } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { BulkSelectTableBody } from "@/components/ui-custom/BulkSelectTableBody";
import { TableCell, TableRow } from "@/components/ui/table";

const DEFAULT_ROW_HEIGHT = 40;

type VirtualizedTableBodyProps = {
  scrollRef: React.RefObject<HTMLDivElement | null>;
  rowCount: number;
  colSpan: number;
  estimateRowHeight?: number;
  overscan?: number;
  isLoading?: boolean;
  loading?: React.ReactNode;
  isEmpty?: boolean;
  empty?: React.ReactNode;
  renderRow: (index: number) => React.ReactNode;
};

/** Рендерит только видимые строки tbody; «выбрать всё» остаётся на уровне данных (Set id). */
export function VirtualizedTableBody({
  scrollRef,
  rowCount,
  colSpan,
  estimateRowHeight = DEFAULT_ROW_HEIGHT,
  overscan = 10,
  isLoading,
  loading,
  isEmpty,
  empty,
  renderRow,
}: VirtualizedTableBodyProps) {
  const [scrollEl, setScrollEl] = React.useState<HTMLDivElement | null>(null);

  // ref на scroll-контейнере появляется после commit — подхватываем явно.
  // Не зависим от rowCount: иначе при фильтрах remount/remeasure сбрасывает скролл.
  useLayoutEffect(() => {
    if (scrollRef.current) {
      setScrollEl(scrollRef.current);
      return;
    }
    const frame = requestAnimationFrame(() => {
      if (scrollRef.current) setScrollEl(scrollRef.current);
    });
    return () => cancelAnimationFrame(frame);
  }, [scrollRef]);

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollEl,
    estimateSize: () => estimateRowHeight,
    overscan,
    // Стабильный ключ строк — меньше прыжков при смене фильтров/группировки
    getItemKey: (index) => index,
  });

  useLayoutEffect(() => {
    if (!scrollEl || rowCount <= 0) return;
    virtualizer.measure();
  }, [scrollEl, rowCount, virtualizer]);

  if (isLoading && loading) {
    return <BulkSelectTableBody>{loading}</BulkSelectTableBody>;
  }

  if (isEmpty && empty) {
    return <BulkSelectTableBody>{empty}</BulkSelectTableBody>;
  }

  const items = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();
  // Пока virtualizer не измерил — держим полную высоту-заглушку, чтобы не схлопывать scrollHeight
  const paddingTop = items.length > 0 ? items[0].start : 0;
  const paddingBottom =
    items.length > 0
      ? totalSize - items[items.length - 1].end
      : Math.max(0, rowCount * estimateRowHeight);

  return (
    <BulkSelectTableBody>
      {paddingTop > 0 && (
        <TableRow className="border-0 hover:bg-transparent pointer-events-none">
          <TableCell colSpan={colSpan} className="p-0 border-0" style={{ height: paddingTop }} />
        </TableRow>
      )}
      {items.map((vi) => (
        <React.Fragment key={vi.key}>{renderRow(vi.index)}</React.Fragment>
      ))}
      {items.length === 0 && rowCount > 0 && paddingBottom <= 0
        ? Array.from({ length: Math.min(rowCount, overscan * 2 + 1) }, (_, index) => (
            <React.Fragment key={index}>{renderRow(index)}</React.Fragment>
          ))
        : null}
      {paddingBottom > 0 && (
        <TableRow className="border-0 hover:bg-transparent pointer-events-none">
          <TableCell colSpan={colSpan} className="p-0 border-0" style={{ height: paddingBottom }} />
        </TableRow>
      )}
    </BulkSelectTableBody>
  );
}
