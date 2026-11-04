"use client";

import Link from "next/link";
import type { DeliveryHit } from "@/lib/calc/delivery";
import { StockLink } from "../popup/StockLink";
import { Panel } from "../ui";

/** The top repeat high-delivery names over the longest window; `names` has an entry only for symbols the app tracks. */
export function DeliveryMini({ hits, days, names }: { hits: DeliveryHit[]; days: number; names: Record<string, string> }) {
  return (
    <Panel title={`HIGH DELIVERY · ${days}D`} action={<Link href="/market" className="text-xs text-[var(--muted)] hover:text-[var(--up)]">Market</Link>}>
      {hits.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">No stock has had 60%+ delivery among the busiest names often enough yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {hits.map((h) => (
            <li key={h.symbol} className="flex items-center gap-2 text-sm">
              {names[h.symbol] ? (
                <StockLink stockKey={h.symbol} className="min-w-0 flex-1 truncate font-semibold">{names[h.symbol]}</StockLink>
              ) : (
                <span className="min-w-0 flex-1 truncate font-semibold">{h.symbol}</span>
              )}
              <span className="font-mono text-xs tabular-nums text-[var(--muted)]">{h.days}/{days}</span>
              <span className="w-12 text-right font-mono text-xs tabular-nums text-[var(--up)]">{h.avgPer}%</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
