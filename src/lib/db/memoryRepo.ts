import type { Candle } from "@/lib/provider/types";
import type { Repo } from "./repo";
import type { Instrument, JobRun, Levels, StoredDay } from "./types";

const emptyDay = (date: string): StoredDay => ({
  date, open: null, high: null, low: null, close: null, volume: null,
  pctChange: null, importedPct: null, ema50: null, ema200: null, rsi14: null, rsVsNifty: null,
});
const emptyLevels = (): Levels => ({ autoSupport: null, autoResistance: null, manualSupport: null, manualResistance: null });

export function createMemoryRepo(seed?: { instruments?: Instrument[] }): Repo & { _days: Map<number, Map<string, StoredDay>> } {
  const instruments = new Map<number, Instrument>();
  for (const i of seed?.instruments ?? []) instruments.set(i.id, { ...i });
  let nextId = Math.max(0, ...instruments.keys()) + 1;
  const days = new Map<number, Map<string, StoredDay>>();
  const watchlist = new Set<number>();
  const levels = new Map<number, Levels>();
  const jobRuns: JobRun[] = [];

  const dayFor = (id: number, date: string): StoredDay => {
    let m = days.get(id);
    if (!m) days.set(id, (m = new Map()));
    let d = m.get(date);
    if (!d) m.set(date, (d = emptyDay(date)));
    return d;
  };
  const levelsFor = (id: number): Levels => {
    let l = levels.get(id);
    if (!l) levels.set(id, (l = emptyLevels()));
    return l;
  };
  const byKey = (key: string) => [...instruments.values()].find((i) => i.key === key);

  return {
    _days: days,
    async listInstruments(f) {
      return [...instruments.values()]
        .filter((i) => (!f?.types || f.types.includes(i.type)) && (!f?.activeOnly || i.active))
        .map((i) => ({ ...i }));
    },
    async getInstrumentByKey(key) {
      const i = byKey(key);
      return i ? { ...i } : null;
    },
    async searchInstruments(q, limit) {
      const n = q.toLowerCase();
      return [...instruments.values()]
        .filter((i) => i.type === "stock" && (i.key.toLowerCase().includes(n) || i.name.toLowerCase().includes(n)))
        .slice(0, limit)
        .map((i) => ({ ...i }));
    },
    async upsertInstruments(rows) {
      for (const r of rows) {
        const existing = byKey(r.key);
        if (existing) Object.assign(existing, r);
        else {
          const id = nextId++;
          instruments.set(id, { id, ...r });
        }
      }
    },
    async upsertCandles(id, candles: Candle[]) {
      for (const c of candles) {
        const d = dayFor(id, c.date);
        d.open = c.open; d.high = c.high; d.low = c.low; d.close = c.close; d.volume = c.volume;
      }
    },
    async getDays(id, limit) {
      const all = [...(days.get(id)?.values() ?? [])].sort((a, b) => a.date.localeCompare(b.date));
      return (limit >= all.length ? all : all.slice(all.length - limit)).map((d) => ({ ...d }));
    },
    async upsertIndicators(id, rows) {
      for (const r of rows) {
        const d = dayFor(id, r.date);
        d.pctChange = r.pctChange; d.ema50 = r.ema50; d.ema200 = r.ema200; d.rsi14 = r.rsi14; d.rsVsNifty = r.rsVsNifty;
      }
    },
    async upsertImportedPct(rows) {
      for (const r of rows) dayFor(r.instrumentId, r.date).importedPct = r.importedPct;
    },
    async listWatchlist() {
      return [...watchlist].map((id) => instruments.get(id)).filter((i): i is Instrument => !!i).map((i) => ({ ...i }));
    },
    async addToWatchlist(id) { watchlist.add(id); },
    async removeFromWatchlist(id) { watchlist.delete(id); },
    async getLevels(id) { return { ...(levels.get(id) ?? emptyLevels()) }; },
    async setAutoLevels(id, support, resistance) {
      const l = levelsFor(id);
      l.autoSupport = support; l.autoResistance = resistance;
    },
    async setManualLevels(id, support, resistance) {
      const l = levelsFor(id);
      l.manualSupport = support; l.manualResistance = resistance;
    },
    async logJobRun(run) { jobRuns.push({ ...run }); },
    async lastJobRun(job) {
      const runs = jobRuns.filter((r) => r.job === job);
      return runs.length ? { ...runs[runs.length - 1] } : null;
    },
  };
}
