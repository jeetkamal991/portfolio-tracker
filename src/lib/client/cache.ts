/**
 * Tiny in-memory fetch cache for the browser: no dependency, nothing persisted, nothing shared between tabs or users.
 * - fresh within ttlMs -> served with no request;
 * - stale -> served immediately by `peek` while the caller revalidates (stale-while-revalidate), so content never blanks;
 * - identical requests in flight are shared;
 * - errors and non-200 answers are never cached.
 * It lives in module memory only, so a reload empties it, and sign-out/login call `clearClientCache()` so private data
 * (holdings, watchlist flag, reports in the pop-up) can never carry over to another user in the same tab.
 *
 * Staleness budgets are named, short, and configurable here; market data that moves intraday has its own live polling
 * (/api/quotes) and is never served from this cache.
 */
export const TTL_MS = {
  /** Pop-up payload (prices end-of-day, but holding/watchlist state is private and changes on user action). */
  stock: 60_000,
  /** enhanced_v2 snapshot: written once a day after the close. */
  evaluation: 5 * 60_000,
  /** Full chart history: only changes at end of day. */
  history: 10 * 60_000,
} as const;

const MAX_ENTRIES = 40;

interface Entry { at: number; data: unknown }
const store = new Map<string, Entry>();
const inflight = new Map<string, Promise<CachedResult<unknown>>>();

export interface CachedResult<T> { ok: boolean; status: number; data: T | null; fromCache: boolean }

export function peek<T>(url: string, ttlMs: number): { data: T; fresh: boolean } | null {
  const e = store.get(url);
  return e ? { data: e.data as T, fresh: Date.now() - e.at < ttlMs } : null;
}

export function invalidate(prefix: string): void {
  for (const k of [...store.keys()]) if (k.startsWith(prefix)) store.delete(k);
}

export function clearClientCache(): void {
  store.clear();
  inflight.clear();
}

/** GET JSON. `force` skips a fresh entry (use after a mutation); a stale entry is still available through `peek`. */
export async function fetchCached<T>(url: string, opts: { ttlMs: number; force?: boolean; signal?: AbortSignal }): Promise<CachedResult<T>> {
  if (!opts.force) {
    const hit = peek<T>(url, opts.ttlMs);
    if (hit?.fresh) return { ok: true, status: 200, data: hit.data, fromCache: true };
  }
  const shared = inflight.get(url) as Promise<CachedResult<T>> | undefined;
  if (shared && !opts.force) return shared;
  const p = (async (): Promise<CachedResult<T>> => {
    try {
      const res = await fetch(url, { cache: "no-store", signal: opts.signal });
      if (!res.ok) return { ok: false, status: res.status, data: null, fromCache: false };
      const data = (await res.json()) as T;
      store.set(url, { at: Date.now(), data });
      while (store.size > MAX_ENTRIES) store.delete(store.keys().next().value as string);
      return { ok: true, status: 200, data, fromCache: false };
    } finally {
      inflight.delete(url);
    }
  })();
  inflight.set(url, p);
  return p;
}

export const stockUrl = (key: string) => `/api/instrument/${encodeURIComponent(key)}`;
export const evaluationUrl = (key: string) => `/api/evaluation/${encodeURIComponent(key)}`;
export const historyUrl = (key: string) => `/api/history/${encodeURIComponent(key)}`;

/** Warm the cache for a stock the user is about to open (hover/focus/touch). Safe to call repeatedly: it dedupes and respects TTLs. */
export function prefetchStock(key: string): void {
  void fetchCached(stockUrl(key), { ttlMs: TTL_MS.stock }).catch(() => {});
}

/**
 * fetch() for anything that WRITES (holdings, watchlist, levels, reports). Whatever the outcome, cached pop-up data is dropped
 * afterwards: it contains the owner's own state (position, watchlist flag, reports) and must never be shown out of date.
 */
export async function mutate(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init);
  } finally {
    invalidate("/api/instrument/");
  }
}
