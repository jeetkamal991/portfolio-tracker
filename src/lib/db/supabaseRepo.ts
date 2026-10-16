import type { SupabaseClient } from "@supabase/supabase-js";
import type { Candle } from "@/lib/provider/types";
import { dedupeLastWins } from "./dedupe";
import type { Repo } from "./repo";
import type { Instrument, InstrumentType, JobRun, JobStatus, Levels, StoredDay } from "./types";

const PAGE = 1000; // PostgREST response cap
const CHUNK = 500;

// ---- All snake_case <-> camelCase mapping lives here ----
type Row = Record<string, unknown>;
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

const toInstrument = (r: Row): Instrument => ({
  id: Number(r.id),
  key: r.key as string,
  name: r.name as string,
  type: r.type as InstrumentType,
  yahooTicker: r.yahoo_ticker as string,
  active: r.active as boolean,
});
const fromInstrument = (i: Omit<Instrument, "id">): Row => ({
  key: i.key, name: i.name, type: i.type, yahoo_ticker: i.yahooTicker, active: i.active,
});
const toDay = (r: Row): StoredDay => ({
  date: r.date as string,
  open: num(r.open), high: num(r.high), low: num(r.low), close: num(r.close), volume: num(r.volume),
  pctChange: num(r.pct_change), importedPct: num(r.imported_pct),
  ema50: num(r.ema50), ema200: num(r.ema200), rsi14: num(r.rsi14), rsVsNifty: num(r.rs_vs_nifty),
});
const toLevels = (r: Row | null): Levels => ({
  autoSupport: num(r?.auto_support), autoResistance: num(r?.auto_resistance),
  manualSupport: num(r?.manual_support), manualResistance: num(r?.manual_resistance),
});
const toJobRun = (r: Row): JobRun => ({
  job: r.job as string,
  startedAt: r.started_at as string,
  finishedAt: r.finished_at as string,
  status: r.status as JobStatus,
  message: (r.message as string | null) ?? "",
});
// ---------------------------------------------------------

function chunks<T>(rows: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}
function check<T>(res: { data: T; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data;
}

export function createSupabaseRepo(db: SupabaseClient): Repo {
  const upsertDays = async (rows: Row[], what: string) => {
    const unique = dedupeLastWins(rows, (r) => `${r.instrument_id}|${r.date}`);
    for (const c of chunks(unique)) {
      check(await db.from("daily_prices").upsert(c, { onConflict: "instrument_id,date" }), what);
    }
  };
  const now = () => new Date().toISOString();

  return {
    async listInstruments(f) {
      let q = db.from("instruments").select("*").order("id");
      if (f?.types) q = q.in("type", f.types);
      if (f?.activeOnly) q = q.eq("active", true);
      return (check(await q, "listInstruments") as Row[]).map(toInstrument);
    },
    async getInstrumentByKey(key) {
      const r = check(await db.from("instruments").select("*").eq("key", key).maybeSingle(), "getInstrumentByKey");
      return r ? toInstrument(r as Row) : null;
    },
    async searchInstruments(q, limit) {
      // Strip characters that are special in PostgREST filter syntax / LIKE patterns.
      const safe = q.replace(/[%_,()\\]/g, " ").trim();
      if (!safe) return [];
      const rows = check(
        await db.from("instruments").select("*").eq("type", "stock")
          .or(`key.ilike.%${safe}%,name.ilike.%${safe}%`).order("key").limit(limit),
        "searchInstruments",
      ) as Row[];
      return rows.map(toInstrument);
    },
    async upsertInstruments(rows) {
      for (const c of chunks(dedupeLastWins(rows, (r) => r.key))) {
        check(await db.from("instruments").upsert(c.map(fromInstrument), { onConflict: "key" }), "upsertInstruments");
      }
    },
    async upsertCandles(instrumentId, candles: Candle[]) {
      await upsertDays(
        candles.map((c) => ({
          instrument_id: instrumentId, date: c.date,
          open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume,
        })),
        "upsertCandles",
      );
    },
    async getDays(instrumentId, limit) {
      // Page newest-first with .range() because PostgREST caps responses at 1000 rows.
      const out: Row[] = [];
      while (out.length < limit) {
        const size = Math.min(PAGE, limit - out.length);
        const page = check(
          await db.from("daily_prices").select("*").eq("instrument_id", instrumentId)
            .order("date", { ascending: false }).range(out.length, out.length + size - 1),
          "getDays",
        ) as Row[];
        out.push(...page);
        if (page.length < size) break;
      }
      return out.reverse().map(toDay);
    },
    async upsertIndicators(instrumentId, rows) {
      await upsertDays(
        rows.map((r) => ({
          instrument_id: instrumentId, date: r.date, pct_change: r.pctChange,
          ema50: r.ema50, ema200: r.ema200, rsi14: r.rsi14, rs_vs_nifty: r.rsVsNifty,
        })),
        "upsertIndicators",
      );
    },
    async upsertImportedPct(rows) {
      await upsertDays(
        rows.map((r) => ({ instrument_id: r.instrumentId, date: r.date, imported_pct: r.importedPct })),
        "upsertImportedPct",
      );
    },
    async listWatchlist() {
      const rows = check(
        await db.from("watchlist").select("added_at, instruments(*)").order("added_at"),
        "listWatchlist",
      ) as unknown as { instruments: Row | Row[] | null }[];
      return rows
        .map((r) => (Array.isArray(r.instruments) ? r.instruments[0] : r.instruments))
        .filter((i): i is Row => !!i)
        .map(toInstrument);
    },
    async addToWatchlist(instrumentId) {
      check(
        await db.from("watchlist").upsert({ instrument_id: instrumentId }, { onConflict: "instrument_id", ignoreDuplicates: true }),
        "addToWatchlist",
      );
    },
    async removeFromWatchlist(instrumentId) {
      check(await db.from("watchlist").delete().eq("instrument_id", instrumentId), "removeFromWatchlist");
    },
    async getLevels(instrumentId) {
      const r = check(await db.from("levels").select("*").eq("instrument_id", instrumentId).maybeSingle(), "getLevels");
      return toLevels(r as Row | null);
    },
    async setAutoLevels(instrumentId, support, resistance) {
      check(
        await db.from("levels").upsert(
          { instrument_id: instrumentId, auto_support: support, auto_resistance: resistance, updated_at: now() },
          { onConflict: "instrument_id" },
        ),
        "setAutoLevels",
      );
    },
    async setManualLevels(instrumentId, support, resistance) {
      check(
        await db.from("levels").upsert(
          { instrument_id: instrumentId, manual_support: support, manual_resistance: resistance, updated_at: now() },
          { onConflict: "instrument_id" },
        ),
        "setManualLevels",
      );
    },
    async logJobRun(run) {
      check(
        await db.from("job_runs").insert({
          job: run.job, started_at: run.startedAt, finished_at: run.finishedAt, status: run.status, message: run.message,
        }),
        "logJobRun",
      );
    },
    async lastJobRun(job) {
      const r = check(
        await db.from("job_runs").select("*").eq("job", job).order("started_at", { ascending: false }).limit(1).maybeSingle(),
        "lastJobRun",
      );
      return r ? toJobRun(r as Row) : null;
    },
  };
}
