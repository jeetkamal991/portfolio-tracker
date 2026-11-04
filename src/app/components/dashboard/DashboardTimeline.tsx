"use client";

import { fmtAlertTime } from "@/lib/calc/alerts";
import type { AlertEvent } from "@/lib/db/types";
import { eventKind, KIND_COLOR } from "@/lib/view/alerts";
import { StockLink } from "../popup/StockLink";
import { Panel } from "../ui";

const SHOWN = 4;

export function DashboardTimeline({ events }: { events: AlertEvent[] }) {
  const recent = events.slice(0, SHOWN);
  return (
    <Panel title="On the timeline" action={<a href="/alerts" className="text-xs text-[var(--muted)] hover:text-[var(--up)]">All alerts</a>}>
      {recent.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">Alerts you receive are pinned on the chart and listed here.</p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {recent.map((e) => (
            <li key={e.id} className="flex items-start gap-2.5 text-sm">
              <i className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: `var(${KIND_COLOR[eventKind(e.message)]})` }} aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <StockLink stockKey={e.key} className="block truncate font-semibold">
                  {e.message.replace(/^[^\p{L}\p{N}]+/u, "").split(" · ")[0]}
                </StockLink>
                <span className="font-mono text-[11px] text-[var(--muted)]">{fmtAlertTime(new Date(e.firedAt))}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
