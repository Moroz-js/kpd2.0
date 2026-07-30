"use client";

import { useRef } from "react";
import { cn } from "@/lib/utils";

/**
 * Обёртка над <input type="date">, которая открывает пикер при клике
 * в любом месте инпута (не только по иконке календаря).
 */
export function DateInput({
  className,
  onEmptyFocus,
  onChange,
  value,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & {
  /** Предзаполнение при фокусе на пустом поле — вернуть YYYY-MM-DD */
  onEmptyFocus?: () => string;
}) {
  const ref = useRef<HTMLInputElement>(null);

  function handleClick() {
    try { ref.current?.showPicker(); } catch { /**/ }
  }

  return (
    <input
      ref={ref}
      type="date"
      {...props}
      value={value}
      onClick={(e) => {
        props.onClick?.(e);
        handleClick();
      }}
      onFocus={(e) => {
        props.onFocus?.(e);
        if (value) return;
        const next = onEmptyFocus?.();
        if (next && onChange) {
          onChange({
            ...e,
            target: { ...e.target, value: next },
            currentTarget: { ...e.currentTarget, value: next },
          } as React.ChangeEvent<HTMLInputElement>);
        }
      }}
      onChange={onChange}
      className={cn(
        "flex h-8 w-full rounded-md border border-input bg-background px-3 py-1 text-xs shadow-sm transition-colors",
        "cursor-pointer file:border-0 file:bg-transparent file:text-sm file:font-medium",
        "placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
    />
  );
}
