import type { ReactNode } from "react";
import { fmtPct, pctTone } from "@/lib/view/dashboard";
import { fmtInr, fmtSignedInr } from "@/lib/view/portfolio";
import { Chip, Label } from "../ui";

export interface Totals {
  invested: number;
  value: number;
  pnl: number;
  pnlPct: number | null;
  todayPnl: number;
  count: number;
  unpriced: number;
}

function Tile({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4">
      <div className="flex items-center gap-2">
        <Label>{label}</Label>
      </div>
      {children}
    </div>
  );
}

const BIG = "mt-1 font-mono text-xl font-semibold tabular-nums";

export function SummaryCards({ totals, live }: { totals: Totals; live: boolean }) {
  const priced = totals.count - totals.unpriced > 0;
  const pnlTone = priced ? pctTone(totals.pnl) : "text-[var(--muted)]";
  const todayTone = priced ? pctTone(totals.todayPnl) : "text-[var(--muted)]";
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      <Tile label="Total invested">
        <div className={BIG}>{priced ? fmtInr(totals.invested, 0) : "—"}</div>
      </Tile>
      <Tile label="Current value">
        <div className={BIG}>{priced ? fmtInr(totals.value, 0) : "—"}</div>
      </Tile>
      <Tile label="Overall P/L">
        <div className={`${BIG} ${pnlTone}`}>{priced ? fmtSignedInr(totals.pnl, 0) : "—"}</div>
        <div className={`font-mono text-xs tabular-nums ${pnlTone}`}>{priced ? fmtPct(totals.pnlPct) : "—"}</div>
      </Tile>
      <Tile
        label={
          <span className="inline-flex items-center gap-2">
            Today&apos;s P/L
            {live && <Chip tone="up">LIVE</Chip>}
          </span>
        }
      >
        <div className={`${BIG} ${todayTone}`}>{priced ? fmtSignedInr(totals.todayPnl, 0) : "—"}</div>
      </Tile>
      <Tile label="Holdings">
        <div className={BIG}>{totals.count}</div>
        {totals.unpriced > 0 && <div className="text-xs text-[var(--muted)]">· {totals.unpriced} without price</div>}
      </Tile>
    </div>
  );
}
