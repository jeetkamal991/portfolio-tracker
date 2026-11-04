"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AlertEvent } from "@/lib/db/types";
import { ALERTS_CHANGED } from "./AlertBriefing";

const POLL_MS = 60_000;

/** Top-bar bell: unread count, polled every minute and on focus; the dropdown shows the latest five without marking them read. */
export function Bell() {
  const [unread, setUnread] = useState(0);
  const [latest, setLatest] = useState<AlertEvent[]>([]);
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/alerts/feed", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { unread: number; latest: AlertEvent[] };
      setUnread(data.unread);
      setLatest(data.latest);
    } catch {
      // offline: keep the last count
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), POLL_MS);
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    window.addEventListener(ALERTS_CHANGED, onFocus);
    return () => {
      clearInterval(t);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener(ALERTS_CHANGED, onFocus);
    };
  }, [load]);

  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={wrap} className="relative">
      <button
        type="button"
        onClick={() => {
          if (!open) void load();
          setOpen((o) => !o);
        }}
        aria-expanded={open}
        aria-haspopup="true"
        aria-label={unread > 0 ? `Alerts, ${unread} unread` : "Alerts"}
        className="relative flex h-9 w-9 items-center justify-center rounded-lg text-[var(--muted)] hover:bg-slate-800 hover:text-[var(--text)]"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden>
          <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 min-w-[18px] rounded-full bg-[var(--down)] px-1 text-center font-mono text-[10px] font-semibold leading-[18px] text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="fixed inset-x-3 top-14 z-40 rounded-xl border border-[var(--border)] bg-[var(--panel)] p-3 shadow-2xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-11 sm:w-96">
          {latest.length === 0 ? (
            <p className="px-1 py-2 text-sm text-[var(--muted)]">No alerts have fired yet.</p>
          ) : (
            <ul className="flex flex-col">
              {latest.map((e) => (
                <li
                  key={e.id}
                  className={`border-l-2 px-2 py-1.5 text-sm ${e.read ? "border-l-transparent text-[var(--muted)]" : "border-l-[var(--up)] text-[var(--text)]"}`}
                >
                  {e.message}
                </li>
              ))}
            </ul>
          )}
          <Link href="/alerts" className="mt-2 block border-t border-[var(--border)] px-1 pt-2 text-sm font-medium text-[var(--up)] hover:underline">
            See all alerts →
          </Link>
        </div>
      )}
    </div>
  );
}
