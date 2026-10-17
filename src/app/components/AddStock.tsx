"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

interface Hit { key: string; name: string }

const ERRORS: Record<string, string> = {
  unknown_symbol: "Symbol not found",
  no_data: "No price data for this stock",
  already_added: "Already on your watchlist",
};

export function AddStock() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [adding, setAdding] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const term = q.trim();
    if (!term) {
      setHits([]);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/instruments/search?q=${encodeURIComponent(term)}`, { signal: ctrl.signal });
        if (res.ok) setHits(await res.json());
      } catch {
        // aborted or offline: leave the previous hits
      }
    }, 250);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);

  async function add(hit: Hit) {
    setError(null);
    setAdding(hit.key);
    try {
      const res = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key: hit.key }),
      });
      if (res.ok) {
        setQ("");
        setHits([]);
        router.refresh();
      } else {
        const body: { error?: string } = await res.json().catch(() => ({}));
        setError(ERRORS[body.error ?? ""] ?? "Could not add stock");
      }
    } catch {
      setError("Could not add stock");
    } finally {
      setAdding(null);
    }
  }

  return (
    <div className="relative">
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        disabled={adding !== null}
        placeholder="Add stock — type a name or symbol"
        aria-label="Add stock"
        className="w-full rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--muted)] focus:border-[var(--up)] focus:outline-none"
      />
      {adding && <p className="mt-1 text-xs text-[var(--muted)]">Adding… fetching history</p>}
      {error && <p role="alert" className="mt-1 text-xs text-[var(--down)]">{error}</p>}
      {hits.length > 0 && !adding && (
        <ul className="absolute z-10 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-[var(--border)] bg-[var(--panel)] text-sm shadow-lg">
          {hits.map((h) => (
            <li key={h.key}>
              <button type="button" onClick={() => add(h)} className="w-full px-3 py-2 text-left hover:bg-slate-800/60">
                {h.name} <span className="font-mono text-xs text-[var(--muted)]">({h.key})</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
