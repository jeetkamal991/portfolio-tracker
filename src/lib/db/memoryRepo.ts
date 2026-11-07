import type { HoldingInput } from "@/lib/calc/portfolio";
import type { Candle } from "@/lib/provider/types";
import type { Repo } from "./repo";
import type { AlertEvent, AlertRule, DailySummary, DeliveryRow, Holding, Instrument, JobRun, Levels, ReportRow, ReportWithStock, ScoreRun, ScoreSnapshot, ShareholdingRow, StoredDay } from "./types";

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
  const holdings = new Map<number, HoldingInput>();
  const levels = new Map<number, Levels>();
  const jobRuns: JobRun[] = [];
  const jobRunsById = new Map<number, JobRun>();
  const reports: ReportRow[] = [];
  const delivery = new Map<string, DeliveryRow>();
  const snapshots = new Map<string, ScoreSnapshot>();
  const scoreRuns = new Map<string, ScoreRun>();
  const daysRange = (ids: number[], fromDate: string, toDate: string): Map<number, StoredDay[]> => {
    const out = new Map<number, StoredDay[]>();
    for (const id of new Set(ids)) {
      const rows = [...(days.get(id)?.values() ?? [])]
        .filter((d) => d.date >= fromDate && d.date <= toDate)
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((d) => ({ ...d }));
      if (rows.length) out.set(id, rows);
    }
    return out;
  };
  const summaries = new Map<string, DailySummary>();
  const constituents = new Map<string, Set<number>>();
  type StoredRule = Omit<AlertRule, "key" | "name" | "yahooTicker">;
  type StoredEvent = Omit<AlertEvent, "key" | "name">;
  const rules = new Map<number, StoredRule>();
  let nextRuleId = 1;
  const events: StoredEvent[] = [];
  const shareholding = new Map<string, ShareholdingRow>();

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
  const holdingFor = (id: number): Holding | null => {
    const h = holdings.get(id);
    const i = instruments.get(id);
    return h && i ? { ...h, instrumentId: id, key: i.key, name: i.name, yahooTicker: i.yahooTicker } : null;
  };
  const withInstrument = <T extends { instrumentId: number }>(r: T) => {
    const i = instruments.get(r.instrumentId);
    return i ? [{ ...r, key: i.key, name: i.name, yahooTicker: i.yahooTicker }] : [];
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
    async getDaysOn(ids, date) {
      const out = new Map<number, StoredDay>();
      for (const id of ids) {
        const d = days.get(id)?.get(date);
        if (d) out.set(id, { ...d });
      }
      return out;
    },
    getDaysRange: async (ids, fromDate, toDate) => daysRange(ids, fromDate, toDate),
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
    async listHoldings() {
      return [...holdings.keys()].flatMap((id) => holdingFor(id) ?? []);
    },
    async getHolding(id) { return holdingFor(id); },
    async upsertHolding(id, h) { holdings.set(id, { ...h }); },
    async deleteHolding(id) { holdings.delete(id); },
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
        id: Math.max(0, ...reports.map((r) => r.id)) + 1, instrumentId, status: "pending", requestedAt: new Date().toISOString(),
        completedAt: null, requestedVia: "site", content: null, error: null,
      };
      reports.push(row);
      return { ...row };
    },
    async listReports(instrumentId) {
      return reports.filter((r) => r.instrumentId === instrumentId).map((r) => ({ ...r })).reverse();
    },
    async listAllReports() {
      return reports
        .map((r): ReportWithStock => ({ ...r, key: instruments.get(r.instrumentId)?.key ?? "", name: instruments.get(r.instrumentId)?.name ?? "" }))
        .reverse();
    },
    async deleteReport(id) {
      const i = reports.findIndex((r) => r.id === id);
      if (i >= 0) reports.splice(i, 1);
    },
    async upsertDelivery(rows) {
      for (const r of rows) delivery.set(`${r.symbol}|${r.date}`, { ...r });
    },
    async listDelivery(sinceDate) {
      return [...delivery.values()].filter((r) => r.date >= sinceDate).map((r) => ({ ...r }));
    },
    async getDailySummary(date) {
      const s = summaries.get(date);
      return s ? { ...s } : null;
    },
    async listAlertRules(f) {
      return [...rules.values()]
        .filter((r) => (!f?.activeOnly || r.active) && (!f?.conditions || f.conditions.includes(r.condition)))
        .sort((a, b) => a.id - b.id)
        .flatMap(withInstrument);
    },
    async createAlertRule(r) {
      if (r.source === "holding" && [...rules.values()].some((x) => x.source === "holding" && x.instrumentId === r.instrumentId && x.condition === r.condition)) {
        throw new Error("createAlertRule: duplicate holding rule");
      }
      const row: StoredRule = { ...r, id: nextRuleId++, active: true, lastFiredAt: null, createdAt: new Date().toISOString() };
      rules.set(row.id, row);
      return withInstrument(row)[0];
    },
    async setAlertActive(id, active) {
      const r = rules.get(id);
      if (r) r.active = active;
    },
    async deleteAlertRule(id) {
      rules.delete(id);
      for (const e of events) if (e.alertId === id) e.alertId = null;
    },
    async saveAlertStates(updates) {
      for (const u of updates) {
        const r = rules.get(u.id);
        if (!r) continue;
        r.lastState = u.lastState;
        r.lastLevel = u.lastLevel;
        if (u.lastFiredAt !== undefined) r.lastFiredAt = u.lastFiredAt;
        if (u.active !== undefined) r.active = u.active;
        if (u.value !== undefined) r.value = u.value;
      }
    },
    async insertAlertEvents(rows) {
      for (const e of rows) events.push({ ...e, id: events.length + 1, read: false });
    },
    async listAlertEvents(limit) {
      return [...events]
        .sort((a, b) => Number(a.read) - Number(b.read) || b.firedAt.localeCompare(a.firedAt) || b.id - a.id)
        .flatMap((e) => {
          const i = instruments.get(e.instrumentId);
          return i ? [{ ...e, key: i.key, name: i.name }] : [];
        })
        .slice(0, limit);
    },
    async unreadAlertCount() {
      return events.filter((e) => !e.read).length;
    },
    async markAlertsRead(ids) {
      for (const e of events) if (ids === "all" || ids.includes(e.id)) e.read = true;
    },
    async listShareholding(quarterEnds, instrumentIds) {
      return [...shareholding.values()].filter((r) => quarterEnds.includes(r.quarterEnd) && (!instrumentIds || instrumentIds.includes(r.instrumentId))).map((r) => ({ ...r }));
    },
    async latestShareholdingQuarter() {
      return [...shareholding.values()].reduce<string | null>((m, r) => (m === null || r.quarterEnd > m ? r.quarterEnd : m), null);
    },
    async upsertShareholding(rows) {
      for (const r of rows) shareholding.set(`${r.instrumentId}|${r.quarterEnd}`, { ...r });
    },
    async upsertSnapshots(rows) {
      for (const r of rows) {
        const k = `${r.instrumentId}|${r.evaluationDate}|${r.scoringVersion}`;
        snapshots.set(k, { ...r, createdAt: snapshots.get(k)?.createdAt ?? new Date().toISOString() });
      }
    },
    async listSnapshots(f) {
      return [...snapshots.values()].filter((r) => r.scoringVersion === f.version && r.evaluationDate === f.date).map((r) => ({ ...r }));
    },
    async getScoreRun(runDate, version) {
      const r = scoreRuns.get(`${runDate}|${version}`);
      return r ? { ...r, failed: r.failed.map((f) => ({ ...f })) } : null;
    },
    async ensureScoreRun(runDate, version, total, maxBatches) {
      const k = `${runDate}|${version}`;
      if (!scoreRuns.has(k)) {
        scoreRuns.set(k, { id: scoreRuns.size + 1, runDate, scoringVersion: version, status: "pending", total, nextOffset: 0, processed: 0, failed: [], batches: 0, maxBatches, lockedUntil: null, lastSuccessAt: null, finishedAt: null, error: null });
      }
      const r = scoreRuns.get(k)!;
      return { ...r, failed: r.failed.map((f) => ({ ...f })) };
    },
    async claimScoreRun(runDate, version, now, leaseMs) {
      const r = scoreRuns.get(`${runDate}|${version}`);
      if (!r) return { claimed: false, run: null };
      const snap = () => ({ ...r, failed: r.failed.map((f) => ({ ...f })) });
      if (r.status === "completed" || r.status === "failed") return { claimed: false, run: snap() };
      if (r.lockedUntil !== null && Date.parse(r.lockedUntil) > now.getTime()) return { claimed: false, run: snap() };
      if (r.batches >= r.maxBatches) {
        r.status = "failed";
        r.error = `Batch allowance of ${r.maxBatches} used up before the run finished`;
        r.finishedAt = now.toISOString();
        return { claimed: false, run: snap() };
      }
      r.batches++;
      r.status = "running";
      r.lockedUntil = new Date(now.getTime() + leaseMs).toISOString();
      return { claimed: true, run: snap() };
    },
    async saveScoreRun(run) {
      scoreRuns.set(`${run.runDate}|${run.scoringVersion}`, { ...run, failed: run.failed.map((f) => ({ ...f })), lockedUntil: null });
    },
    async latestSnapshotDate(version) {
      return [...snapshots.values()].filter((r) => r.scoringVersion === version).reduce<string | null>((m, r) => (m === null || r.evaluationDate > m ? r.evaluationDate : m), null);
    },
    async getSnapshot(instrumentId, version, date) {
      const rows = [...snapshots.values()].filter((r) => r.instrumentId === instrumentId && r.scoringVersion === version && (!date || r.evaluationDate === date));
      rows.sort((a, b) => b.evaluationDate.localeCompare(a.evaluationDate));
      return rows[0] ? { ...rows[0] } : null;
    },
    async listSnapshotsRange(version, fromDate, toDate) {
      return [...snapshots.values()]
        .filter((r) => r.scoringVersion === version && r.evaluationDate >= fromDate && r.evaluationDate <= toDate)
        .sort((a, b) => a.evaluationDate.localeCompare(b.evaluationDate) || a.instrumentId - b.instrumentId)
        .map((r) => ({ ...r }));
    },
    async getRecentDays(ids, perInstrument) {
      const out = new Map<number, StoredDay[]>();
      for (const id of new Set(ids)) {
        const rows = [...(days.get(id)?.values() ?? [])].sort((a, b) => a.date.localeCompare(b.date)).slice(-perInstrument).map((d) => ({ ...d }));
        if (rows.length) out.set(id, rows);
      }
      return out;
    },
    async getCloseEma200(ids, fromDate) { // `sessions` only sizes Supabase page reads
      return [...daysRange(ids, fromDate, "9999-12-31").values()].flat().map((d) => ({ date: d.date, close: d.close, ema200: d.ema200 }));
    },
    async getChartDays(instrumentId, limit) {
      return [...(days.get(instrumentId)?.values() ?? [])].sort((a, b) => a.date.localeCompare(b.date)).slice(-limit).map((d) => ({ ...d }));
    },
    async getLevelsMany(ids) {
      return new Map([...new Set(ids)].map((id) => [id, { ...(levels.get(id) ?? emptyLevels()) }]));
    },
    async listConstituentsMany(keys) {
      const out = new Map<string, Instrument[]>();
      for (const k of keys) out.set(k, await this.listConstituents(k));
      return out;
    },
    async listSnapshotSummaries(f) {
      return (await this.listSnapshots(f)).map((r) => {
        const cov = (r.dataCoverage ?? {}) as { technical?: { coverage?: number }; tradeQuality?: { coverage?: number; rankable?: boolean; observation?: string }; confidence?: { status?: string }; metrics?: unknown; categoryShares?: unknown };
        return {
          ...r, categoryBreakdown: {},
          dataCoverage: { technical: { coverage: cov.technical?.coverage }, tradeQuality: { coverage: cov.tradeQuality?.coverage, rankable: cov.tradeQuality?.rankable, observation: cov.tradeQuality?.observation }, confidence: { status: cov.confidence?.status }, metrics: cov.metrics, categoryShares: cov.categoryShares },
        };
      });
    },
  };
}
