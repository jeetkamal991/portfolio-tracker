"use client";

import { usePathname, useSearchParams } from "next/navigation";
import type { MouseEvent, ReactNode } from "react";

/** `?stock=KEY` merged into the current URL's params, on the current path. */
export function stockHref(pathname: string, params: URLSearchParams | null, key: string): string {
  const next = new URLSearchParams(params?.toString() ?? "");
  next.set("stock", key);
  return `${pathname}?${next.toString()}`;
}

/*
 * The pop-up is opened and closed with the native History API, which the App Router syncs into
 * useSearchParams / usePathname without a server request (a router navigation would re-render
 * the force-dynamic layout first, a multi-second wait). `pushedByApp` records that the current
 * pop-up entry was pushed by us, so closing can step back instead of stacking a second entry.
 */
let pushedByApp = false;

/** Opens the pop-up for `key`. Switching stocks while one is open replaces the entry, so one Back closes. */
export function openStock(key: string, tab?: string) {
  const { pathname, search } = window.location;
  const params = new URLSearchParams(search);
  if (tab) params.set("tab", tab);
  const url = stockHref(pathname, params, key);
  if (params.has("stock")) {
    window.history.replaceState(null, "", url);
  } else {
    window.history.pushState(null, "", url);
    pushedByApp = true;
  }
}

/** Closes the pop-up: Back when we pushed its entry, else drop only `stock` from the URL in place. */
export function closeStock() {
  const { pathname, search } = window.location;
  const params = new URLSearchParams(search);
  if (!params.has("stock")) return;
  if (pushedByApp) {
    pushedByApp = false;
    window.history.back();
    return;
  }
  params.delete("stock");
  params.delete("tab");
  const qs = params.toString();
  window.history.replaceState(null, "", qs ? `${pathname}?${qs}` : pathname);
}

/** Called when the pop-up closes some other way (browser Back, a tab link) so a stale flag never steps back too far. */
export function forgetPushedStock() {
  pushedByApp = false;
}

/**
 * Opens the stock pop-up for `stockKey`; keeps other params (e.g. `?s=` on /sectors). A real
 * `<a href>` so middle-click / modifier-click / open-in-new-tab work; plain left-clicks are
 * intercepted and handled with `openStock`.
 */
export function StockLink({ stockKey, children, className = "" }: { stockKey: string; children: ReactNode; className?: string }) {
  const pathname = usePathname() ?? "/";
  const params = useSearchParams();
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    openStock(stockKey);
  };
  return (
    <a href={stockHref(pathname, params, stockKey)} onClick={onClick} className={`hover:text-[var(--up)] ${className}`}>
      {children}
    </a>
  );
}
