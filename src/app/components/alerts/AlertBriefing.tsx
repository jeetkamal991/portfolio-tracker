"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { fmtAlertTime } from "@/lib/calc/alerts";
import type { AlertsData } from "@/lib/api/alerts";
import type { AlertEvent } from "@/lib/db/types";
import { eventKind, telegramIcon, urgencyOf, type EventKind } from "@/lib/view/alerts";
import { openStock, StockLink } from "../popup/StockLink";
import { Label, Panel } from "../ui";

/** Tells the top-bar bell to refresh its count now. */
export const ALERTS_CHANGED = "alerts:changed";

const STRIPE: Record<EventKind, string> = {
  stop_hit: "var(--down)",
  near_stop: "var(--warn)",
  target_hit: "var(--up)",
  near_target: "var(--up)",
  report: "var(--ema20)",
  other: "var(--muted)",
};

const btn = "rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-3 py-1.5 text-sm font-semibold hover:bg-slate-800";
const btnPrimary = "rounded-lg border border-[var(--up)] bg-[var(--up)] px-3 py-1.5 text-sm font-semibold text-[var(--bg)] hover:brightness-110";

/** "🛑 ACE stop loss hit ₹1,000.00 · ₹994.70 · 30 Oct 17:12" -> title and detail. */
function split(message: string): { title: string; detail: string } {
  const [head = "", ...rest] = message.replace(/^[^\p{L}\p{N}]+/u, "").split(" · ");
  return { title: head, detail: rest.join(" · ") };
}

export function AlertBriefing({ data, today }: { data: AlertsData; today: string }) {
  const router = useRouter();
  // Optimistic read marks; the server copy catches up on refresh.
  const [readIds, setReadIds] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const isRead = (e: AlertEvent) => e.read || readIds.has(e.id);

  const unread = data.events
    .filter((e) => !isRead(e))
    .map((e) => ({ e, kind: eventKind(e.message) }))
    .sort((a, b) => urgencyOf(a.kind) - urgencyOf(b.kind) || b.e.firedAt.localeCompare(a.e.firedAt));
  const earlier = data.events.filter(isRead);
  const urgent = unread.filter((u) => u.kind === "stop_hit" || u.kind === "near_stop").length;
  const activeRules = data.rules.filter((r) => r.active).length;
  const lastFired = data.events[0] ? fmtAlertTime(new Date(data.events[0].firedAt)) : "never";

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
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.1fr_1fr]">
        <div className="flex flex-col justify-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-6">
          <Label>{today}</Label>
          <h1 className="text-balance text-3xl font-extrabold leading-tight tracking-tight sm:text-4xl">
            {unread.length === 0 ? (
              <>Nothing needs you right now.</>
            ) : (
              <>
                {unread.length} {unread.length === 1 ? "thing needs" : "things need"} you today.
                {urgent > 0 && <span className="block text-[var(--muted)]">{urgent} {urgent === 1 ? "is" : "are"} urgent.</span>}
              </>
            )}
          </h1>
          <div className="mt-2 flex flex-wrap gap-x-8 gap-y-3">
            <Stat label="Unread" value={String(unread.length)} />
            <Stat label="Active rules" value={String(activeRules)} />
            <Stat label="Telegram" value={data.telegram === "connected" ? "Connected" : "Not connected"} tone={data.telegram === "connected" ? "text-[var(--up)]" : "text-[var(--warn)]"} />
            <Stat label="Last fired" value={lastFired} />
          </div>
          {unread.length > 1 && (
            <button type="button" onClick={() => void markRead({ all: true }, unread.map((u) => u.e.id))} className="self-start text-xs text-[var(--muted)] hover:text-[var(--up)]">
              Dismiss all
            </button>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-3" aria-label="Needs action">
          {error && <p role="alert" className="text-xs text-[var(--down)]">{error}</p>}
          {unread.length === 0 ? (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5 text-sm text-[var(--muted)]">
              {data.events.length === 0 ? "No alerts have fired yet." : "You are all caught up. Earlier alerts are listed below."}
            </div>
          ) : (
            unread.map(({ e, kind }) => {
              const { title, detail } = split(e.message);
              return (
                <div key={e.id} className="grid grid-cols-[4px_1fr] items-center gap-x-3 gap-y-2 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel)] py-3 pr-3 sm:grid-cols-[4px_1fr_auto]">
                  <i className="self-stretch" style={{ background: STRIPE[kind] }} />
                  <div className="min-w-0">
                    <div className="text-[15px] font-bold">{title}</div>
                    {detail && <div className="mt-0.5 font-mono text-xs text-[var(--muted)]">{detail}</div>}
                  </div>
                  <div className="col-start-2 flex flex-wrap gap-2 sm:col-start-auto">
                    {kind === "report" ? (
                      <button type="button" onClick={() => { openStock(e.key, "deep"); void markRead({ ids: [e.id] }, [e.id]); }} className={btnPrimary}>Read it</button>
                    ) : kind === "target_hit" ? (
                      <>
                        <Link href={`/portfolio?edit=${encodeURIComponent(e.key)}`} className={btnPrimary}>Raise stop</Link>
                        <button type="button" onClick={() => openStock(e.key)} className={btn}>Open stock</button>
                      </>
                    ) : (
                      <button type="button" onClick={() => openStock(e.key)} className={btnPrimary}>Open stock</button>
                    )}
                    <button type="button" onClick={() => void markRead({ ids: [e.id] }, [e.id])} className={btn}>Dismiss</button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {earlier.length > 0 && (
        <Panel title={`Earlier · ${earlier.length}`}>
          <ul className="flex flex-col gap-1.5">
            {earlier.map((e) => {
              const tg = telegramIcon(e.telegramStatus);
              return (
                <li key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-[var(--muted)]">
                  <span className="min-w-0 flex-1">{e.message}</span>
                  <span className="font-mono text-[11px]">{fmtAlertTime(new Date(e.firedAt))}</span>
                  <StockLink stockKey={e.key} className="font-mono text-[11px]">{e.key}</StockLink>
                  <span title={tg.title} aria-label={tg.title}>{tg.icon}</span>
                </li>
              );
            })}
          </ul>
        </Panel>
      )}
    </div>
  );
}

function Stat({ label, value, tone = "" }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <Label>{label}</Label>
      <div className={`font-mono text-lg font-semibold tabular-nums ${tone}`}>{value}</div>
    </div>
  );
}
