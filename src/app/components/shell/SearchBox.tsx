"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { SearchHit } from "@/lib/api/search";
import { openStock } from "../popup/StockLink";

const TYPE_LABEL: Record<SearchHit["type"], string> = { stock: "", index: "INDEX", sector: "SECTOR" };

/** Top-bar type-ahead over stocks, indices and sectors; picking one opens the pop-up (`?stock=KEY`). */
export function SearchBox() {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false); // phones: the input is behind an icon button
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/instruments/search?q=${encodeURIComponent(term)}&scope=all`, { signal: ctrl.signal });
        if (res.ok) {
          setHits(await res.json());
          setActive(0);
        }
      } catch {
        // aborted or offline: keep the previous hits
      }
    }, 250);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);

  const shown = q.trim().length >= 2 ? hits : [];

  function pick(hit: SearchHit) {
    // History API (no server round-trip); keeps other params such as `?s=` on /sectors.
    openStock(hit.key);
    setQ("");
    setHits([]);
    setOpen(false);
    inputRef.current?.blur();
  }

  return (
    <div className="relative flex items-center">
      <button
        type="button"
        aria-label="Search stocks"
        aria-expanded={open}
        onClick={() => {
          setOpen((o) => !o);
          setTimeout(() => inputRef.current?.focus(), 0);
        }}
        className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-[var(--muted)] hover:bg-slate-800 hover:text-[var(--text)] md:hidden"
      >
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4" aria-hidden>
          <circle cx="9" cy="9" r="6" />
          <path d="m14 14 4 4" strokeLinecap="round" />
        </svg>
      </button>
      <div
        className={`${open ? "fixed inset-x-0 top-14 z-40 border-b border-[var(--border)] bg-[var(--panel)] p-3" : "hidden"} md:static md:block md:border-0 md:bg-transparent md:p-0`}
      >
        <input
          ref={inputRef}
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" && shown.length) {
              e.preventDefault();
              setActive((a) => (a + 1) % shown.length);
            } else if (e.key === "ArrowUp" && shown.length) {
              e.preventDefault();
              setActive((a) => (a - 1 + shown.length) % shown.length);
            } else if (e.key === "Enter" && shown[active]) {
              e.preventDefault();
              pick(shown[active]);
            } else if (e.key === "Escape") {
              setQ("");
              setOpen(false);
            }
          }}
          placeholder="Search stock, sector, index"
          aria-label="Search stocks, sectors and indices"
          role="combobox"
          aria-expanded={shown.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={shown.length ? `${listId}-${active}` : undefined}
          className="w-full rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-3 py-1.5 text-sm text-[var(--text)] placeholder:text-[var(--muted)] focus:border-[var(--up)] focus:outline-none md:w-56 xl:w-72"
        />
        {shown.length > 0 && (
          <ul
            id={listId}
            role="listbox"
            className="absolute left-3 right-3 z-40 mt-1 max-h-72 overflow-auto rounded-lg border border-[var(--border)] bg-[var(--panel)] text-sm shadow-lg md:left-auto md:right-0 md:w-80"
          >
            {shown.map((h, i) => (
              <li
                key={h.key}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(h)}
                onMouseEnter={() => setActive(i)}
                className={`flex cursor-pointer items-center justify-between gap-2 px-3 py-2 ${i === active ? "bg-slate-800/80" : ""}`}
              >
                <span className="min-w-0 truncate">
                  {h.name} <span className="font-mono text-xs text-[var(--muted)]">({h.key})</span>
                </span>
                {TYPE_LABEL[h.type] && (
                  <span className="shrink-0 font-mono text-[10px] tracking-wider text-[var(--muted)]">{TYPE_LABEL[h.type]}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
