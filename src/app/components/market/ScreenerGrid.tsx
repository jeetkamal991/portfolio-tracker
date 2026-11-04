"use client";

import { useState } from "react";
import type { ScreenerResult } from "@/lib/calc/screeners";
import { fmtDate } from "@/lib/view/dashboard";
import { COLLAPSED_ROWS, metricText } from "@/lib/view/market";
import { ScoreLabelChip } from "../popup/ScoreBadge";
import { StockLink } from "../popup/StockLink";
import { Chip, Label, Panel, PctText } from "../ui";

function ScreenerCard({ s }: { s: ScreenerResult }) {
  const [all, setAll] = useState(false);
  const rows = all ? s.hits : s.hits.slice(0, COLLAPSED_ROWS);
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-lg border border-[var(--border)] bg-[var(--panel-2)] p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{s.title}</h3>
        <Chip tone="neutral">{s.count}</Chip>
      </div>
      {s.hits.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">No stocks match today</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {rows.map((h) => {
            const text = metricText(s.id, h);
            return (
              <li key={h.key} className="flex items-center gap-2">
                <StockLink stockKey={h.key} className="min-w-0 flex-1 truncate text-sm font-semibold">
                  {h.name}
                </StockLink>
                {h.flag && <Chip tone={h.flag === "NEW_HIGH" ? "up" : "down"}>{h.flag === "NEW_HIGH" ? "NEW HIGH" : "NEW LOW"}</Chip>}
                {h.scoreLabel ? (
                  <ScoreLabelChip label={h.scoreLabel} score={h.metric ?? undefined} />
                ) : (
                  text && <span className="whitespace-nowrap font-mono text-xs tabular-nums text-[var(--text)]">{text}</span>
                )}
                <PctText value={h.dayPct} className="w-16 shrink-0 text-right text-xs" />
              </li>
            );
          })}
        </ul>
      )}
      {s.hits.length > COLLAPSED_ROWS && (
        <button
          type="button"
          onClick={() => setAll((v) => !v)}
          className="self-start font-mono text-xs text-[var(--up)] hover:underline"
        >
          {all ? "Show fewer" : `Show all ${s.hits.length}`}
        </button>
      )}
    </div>
  );
}

export function ScreenerGrid({
  screeners,
  session,
  hasUniverse,
}: {
  screeners: ScreenerResult[];
  session: string | null;
  hasUniverse: boolean;
}) {
  return (
    <Panel
      title="SCREENERS · NIFTY 200"
      action={session ? <Label>as of {fmtDate(session).slice(0, 6)}</Label> : undefined}
    >
      {!hasUniverse ? (
        <p className="text-sm text-[var(--muted)]">Screeners appear after the Nifty 200 list is imported.</p>
      ) : screeners.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">No session data yet.</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {screeners.map((s) => (
            <ScreenerCard key={s.id} s={s} />
          ))}
        </div>
      )}
    </Panel>
  );
}
