import type { Candle } from "@/lib/provider/types";
import type { Repo } from "./repo";
import type { DailySummary, Instrument, JobRun, Levels, ReportRow, StoredDay } from "./types";

const emptyDay = (date: string): StoredDay => ({
  date, open: null, high: null, low: null, close: null, volume: null,
  pctChange: null, importedPct: null, ema20: null, ema50: null, ema200: null, rsi14: null, rsVsNifty: null,
  macd: null, macdSignal: null, macdHist: null, bbUpper: null, bbMiddle: null, bbLower: null,
  volAvg20: null, high52w: null, low52w: null, patterns: null,
  rsVsSector: null, score: null, scoreComponents: null, scoreLabel: null, scoreConfidence: null, scoreSignal: null,
});
const emptyLevels = (): Levels => ({ autoSupport: null, autoResistance: null, manualSupport: null, manualResistance: null });

export function createMemoryRepo(seed?: { instruments?: Instrument[] }): Repo & {
  _days: Map<number, Map<string, StoredDay>>;
  _summaries: Map<string, DailySummary>;
  _jobRuns: JobRun[];
} {
  const instruments = new Map<number, Instrument>();
  for (const i of seed?.instruments ?? []) instruments.set(i.id, { ...i });
  let nextId = Math.max(0, ...instruments.keys()) + 1;
  const days = new Map<number, Map<string, StoredDay>>();
  const watchlist = new Set<number>();
  const levels = new Map<number, Levels>();
  const jobRuns: JobRun[] = [];
  const jobRunsById = new Map<number, JobRun>();
  const reports: ReportRow[] = [];
  const summaries = new Map<string, DailySummary>();
  const constituents = new Map<string, Set<number>>();

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
    _summaries: summaries,
    _jobRuns: jobRuns,
    async listInstruments(f) {
      return [...instruments.values()]
        .filter((i) => (!f?.types || f.types.includes(i.type)) && (!f?.activeOnly || i.active))
        .map((i) => ({ ...i }));
    },
    async getInstrumentByKey(key) {
      const i = byKey(key);
      return i ? { ...i } : null;
    },
    async searchInstruments(q, limit, opts) {
      const n = q.toLowerCase();
      return [...instruments.values()]
        .filter((i) => (opts?.includeIndices || i.type === "stock") && (i.key.toLowerCase().includes(n) || i.name.toLowerCase().includes(n)))
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
    async getPriceBars(id, limit) {
      const all = [...(days.get(id)?.values() ?? [])].sort((a, b) => a.date.localeCompare(b.date));
      return (limit >= all.length ? all : all.slice(all.length - limit))
        .map(({ date, open, high, low, close, volume }) => ({ date, open, high, low, close, volume }));
    },
    async upsertIndicators(id, rows) {
      for (const r of rows) {
        const d = dayFor(id, r.date);
        d.pctChange = r.pctChange; d.ema20 = r.ema20; d.ema50 = r.ema50; d.ema200 = r.ema200; d.rsi14 = r.rsi14; d.rsVsNifty = r.rsVsNifty;
        d.macd = r.macd; d.macdSignal = r.macdSignal; d.macdHist = r.macdHist;
        d.bbUpper = r.bbUpper; d.bbMiddle = r.bbMiddle; d.bbLower = r.bbLower;
        d.volAvg20 = r.volAvg20; d.high52w = r.high52w; d.low52w = r.low52w; d.patterns = r.patterns;
      }
    },
    async upsertScore(id, row) {
      const d = dayFor(id, row.date);
      d.rsVsSector = row.rsVsSector; d.score = row.score; d.scoreComponents = row.scoreComponents;
      d.scoreLabel = row.scoreLabel; d.scoreConfidence = row.scoreConfidence; d.scoreSignal = row.scoreSignal;
    },
    async replaceConstituents(indexKey, ids) { constituents.set(indexKey, new Set(ids)); },
    async listConstituents(indexKey) {
      return [...(constituents.get(indexKey) ?? [])]
        .map((id) => instruments.get(id)).filter((i): i is Instrument => !!i).map((i) => ({ ...i }));
    },
    async listMemberships() {
      return [...constituents].flatMap(([indexKey, ids]) => [...ids].map((instrumentId) => ({ indexKey, instrumentId })));
    },
    async getLatestDay(id) {
      const priced = [...(days.get(id)?.values() ?? [])].filter((d) => d.close !== null);
      priced.sort((a, b) => a.date.localeCompare(b.date));
      const d = priced[priced.length - 1];
      return d ? { ...d } : null;
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
    async startJobRun(job, startedAt) {
      const row: JobRun = { job, startedAt, finishedAt: null, status: "running", message: "" };
      jobRuns.push(row);
      const id = jobRuns.length;
      jobRunsById.set(id, row);
      return id;
    },
    async finishJobRun(id, result) {
      const row = jobRunsById.get(id);
      if (!row) throw new Error(`finishJobRun: no job run ${id}`);
      Object.assign(row, result);
    },
    async lastJobRun(job) {
      // Latest started_at (ISO strings compare chronologically); ties go to the later insert.
      const run = jobRuns
        .filter((r) => r.job === job)
        .reduce<JobRun | undefined>((a, r) => (!a || r.startedAt >= a.startedAt ? r : a), undefined);
      return run ? { ...run } : null;
    },
    async requestReport(instrumentId) {
      const row: ReportRow = {
        id: reports.length + 1, instrumentId, status: "pending", requestedAt: new Date().toISOString(),
        completedAt: null, requestedVia: "site", content: null, error: null,
      };
      reports.push(row);
      return { ...row };
    },
    async listReports(instrumentId) {
      return reports.filter((r) => r.instrumentId === instrumentId).map((r) => ({ ...r })).reverse();
    },
    async getDailySummary(date) {
      const s = summaries.get(date);
      return s ? { ...s } : null;
    },
  };
}
