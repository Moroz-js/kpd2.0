"use client";

import * as React from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";

function sameDestination(href: string): boolean {
  try {
    const url = new URL(href, window.location.href);
    if (url.origin !== window.location.origin) return true;
    return (
      url.pathname === window.location.pathname &&
      url.search === window.location.search
    );
  } catch {
    return true;
  }
}

/** Индикатор soft-navigation: сразу по клику по внутренней ссылке. */
export function NavigationProgress() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, setPending] = React.useState(false);
  const key = `${pathname}?${searchParams.toString()}`;

  React.useEffect(() => {
    setPending(false);
  }, [key]);

  React.useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      const anchor = (event.target as HTMLElement | null)?.closest(
        "a[href]"
      ) as HTMLAnchorElement | null;
      if (!anchor) return;
      if (anchor.target && anchor.target !== "_self") return;
      if (anchor.hasAttribute("download")) return;
      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) {
        return;
      }
      if (sameDestination(anchor.href)) return;
      setPending(true);
    };

    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  if (!pending) return null;

  return (
    <>
      <div
        aria-hidden
        className="pointer-events-none fixed inset-x-0 top-0 z-[100] h-0.5 overflow-hidden bg-neutral-200"
      >
        <div className="h-full w-1/3 animate-[navProgress_1.05s_ease-in-out_infinite] rounded-r-full bg-neutral-800" />
      </div>
      <div
        className="pointer-events-none fixed inset-0 z-[90] flex items-start justify-center bg-neutral-50/35 pt-[28vh]"
        aria-live="polite"
        aria-busy="true"
      >
        <div className="flex items-center gap-2 rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-600 shadow-sm">
          <Loader2 className="h-4 w-4 animate-spin" />
          Загрузка…
        </div>
      </div>
    </>
  );
}
