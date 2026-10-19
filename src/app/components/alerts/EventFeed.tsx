"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { fmtAlertTime } from "@/lib/calc/alerts";
import type { AlertEvent } from "@/lib/db/types";
import { telegramIcon } from "@/lib/view/alerts";
import { StockLink } from "../popup/StockLink";
import { Panel } from "../ui";

/** Tells the top-bar bell to refresh its count now. */
export const ALERTS_CHANGED = "alerts:changed";

const ICON_TONE = { up: "text-[var(--up)]", warn: "text-[var(--warn)]", neutral: "text-[var(--muted)]" } as const;

export function EventFeed({ events }: { events: AlertEvent[] }) {
  const router = useRouter();
  // Optimistic read marks; the server copy catches up on refresh.
  const [readIds, setReadIds] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const isRead = (e: AlertEvent) => e.read || readIds.has(e.id);
  const unread = events.filter((e) => !isRead(e));

  async function markRead(body: { ids: number[] } | { all: true }, ids: number[]) {
    setError(null);
    setReadIds((s) => new Set([...s, ...ids]));
    try {
      const res = await fetch("/api/alerts/read", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error();
      window.dispatchEvent(new Event(ALERTS_CHANGED));
      router.refresh();
    } catch {
      setReadIds((s) => new Set([...s].filter((id) => !ids.includes(id))));
      setError("Could not mark as read");
    }
  }

  return (
    <Panel
      title="Alert feed"
      action={
        unread.length > 0 && (
          <button type="button" onClick={() => void markRead({ all: true }, unread.map((e) => e.id))} className="text-xs text-[var(--muted)] hover:text-[var(--up)]">
            Mark all read
          </button>
        )
      }
    >
      {error && <p role="alert" className="mb-2 text-xs text-[var(--down)]">{error}</p>}
      {events.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">No alerts have fired yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {events.map((e) => {
            const read = isRead(e);
            const tg = telegramIcon(e.telegramStatus);
            return (
              <li
                key={e.id}
                className={`rounded-lg border border-[var(--border)] border-l-4 px-3 py-2 ${
                  read ? "border-l-transparent" : "border-l-[var(--up)] bg-[var(--panel-2)]"
                }`}
              >
                <button
                  type="button"
                  onClick={() => !read && void markRead({ ids: [e.id] }, [e.id])}
                  className={`w-full text-left text-sm ${read ? "text-[var(--muted)]" : "font-medium text-[var(--text)]"}`}
                  aria-label={read ? e.message : `${e.message} (unread, click to mark read)`}
                >
                  {e.message}
                </button>
                <div className="mt-1 flex items-center gap-3 font-mono text-[11px] text-[var(--muted)]">
                  <span>{fmtAlertTime(new Date(e.firedAt))}</span>
                  <StockLink stockKey={e.key}>{e.key}</StockLink>
                  <span title={tg.title} aria-label={tg.title} className={ICON_TONE[tg.tone]}>
                    {tg.icon}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
