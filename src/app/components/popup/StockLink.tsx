"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";

/** `?stock=KEY` merged into the current URL's params, on the current path. */
export function stockHref(pathname: string, params: URLSearchParams | null, key: string): string {
  const next = new URLSearchParams(params?.toString() ?? "");
  next.set("stock", key);
  return `${pathname}?${next.toString()}`;
}

/** Opens the stock pop-up for `stockKey`; keeps other params (e.g. `?s=` on /sectors). */
export function StockLink({ stockKey, children, className = "" }: { stockKey: string; children: ReactNode; className?: string }) {
  const pathname = usePathname() ?? "/";
  const params = useSearchParams();
  return (
    <Link href={stockHref(pathname, params, stockKey)} scroll={false} className={`hover:text-[var(--up)] ${className}`}>
      {children}
    </Link>
  );
}
