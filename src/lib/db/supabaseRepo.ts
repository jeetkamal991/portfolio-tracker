import type { SupabaseClient } from "@supabase/supabase-js";
import type { HoldingInput } from "@/lib/calc/portfolio";
import { addDays, istDate } from "@/lib/time/ist";
import type { Candle } from "@/lib/provider/types";
import { dedupeLastWins } from "./dedupe";
import type { Repo } from "./repo";
import type { AlertEvent, AlertRule, DailySummary, DeliveryRow, Holding, Instrument, InstrumentType, JobRun, JobStatus, Levels, OhlcvDay, PriceBar, ReportRow, ReportWithStock, ScoreRun, ScoreSnapshot, ShareholdingRow, StoredDay } from "./types";

const PAGE = 1000; // PostgREST response cap
const CHUNK = 500;
const OHLCV_CHUNK = 20;
const OHLCV_COLUMNS = "instrument_id,date,open,high,low,close,volume,pct_change,imported_pct";

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
const toShareholding = (r: Row): ShareholdingRow => ({
  instrumentId: Number(r.instrument_id), quarterEnd: r.quarter_end as string,
  fiiPct: num(r.fii_pct), diiPct: num(r.dii_pct), promoterPct: num(r.promoter_pct), sourceUrl: (r.source_url as string | null) ?? null,
});
const fromInstrument = (i: Omit<Instrument, "id">): Row => ({
  key: i.key, name: i.name, type: i.type, yahoo_ticker: i.yahooTicker, active: i.active,
});
const toDay = (r: Row): StoredDay => ({
  date: r.date as string,
  open: num(r.open), high: num(r.high), low: num(r.low), close: num(r.close), volume: num(r.volume),
  pctChange: num(r.pct_change), importedPct: num(r.imported_pct),
  ema20: num(r.ema20), ema50: num(r.ema50), ema200: num(r.ema200), rsi14: num(r.rsi14), rsVsNifty: num(r.rs_vs_nifty),
  macd: num(r.macd), macdSignal: num(r.macd_signal), macdHist: num(r.macd_hist),
  bbUpper: num(r.bb_upper), bbMiddle: num(r.bb_middle), bbLower: num(r.bb_lower),
  volAvg20: num(r.vol_avg20), high52w: num(r.high_52w), low52w: num(r.low_52w),
  patterns: (r.patterns as StoredDay["patterns"] | null) ?? null,
  rsVsSector: num(r.rs_vs_sector), score: num(r.score),
  scoreComponents: (r.score_components as StoredDay["scoreComponents"] | null) ?? null,
  scoreLabel: (r.score_label as StoredDay["scoreLabel"] | null) ?? null,
  scoreConfidence: (r.score_confidence as StoredDay["scoreConfidence"] | null) ?? null,
  scoreSignal: (r.score_signal as string | null) ?? null,
});
const toBar = (r: Row): PriceBar => ({
  date: r.date as string, open: num(r.open), close: num(r.close), high: num(r.high), low: num(r.low), volume: num(r.volume),
});
const toLevels = (r: Row | null): Levels => ({
  autoSupport: num(r?.auto_support), autoResistance: num(r?.auto_resistance),
  manualSupport: num(r?.manual_support), manualResistance: num(r?.manual_resistance),
});
const toJobRun = (r: Row): JobRun => ({
  job: r.job as string,
  startedAt: r.started_at as string,
  finishedAt: (r.finished_at as string | null) ?? null,
  status: r.status as JobStatus,
  message: (r.message as string | null) ?? "",
});
const toSummary = (r: Row): DailySummary => ({
  date: r.date as string,
  summary: r.summary as string,
  marketEvents: (r.market_events as unknown[] | null) ?? [],
  watchlistNews: (r.watchlist_news as unknown[] | null) ?? [],
});
const toReport = (r: Row): ReportRow => ({
  id: Number(r.id),
  instrumentId: Number(r.instrument_id),
  status: r.status as ReportRow["status"],
  requestedAt: r.requested_at as string,
  completedAt: (r.completed_at as string | null) ?? null,
  requestedVia: r.requested_via as ReportRow["requestedVia"],
  content: r.content ?? null,
  error: (r.error as string | null) ?? null,
});
const toHolding = (r: Row, inst: Row): Holding => ({
  instrumentId: Number(r.instrument_id),
  key: inst.key as string,
  name: inst.name as string,
  yahooTicker: inst.yahoo_ticker as string,
  qty: Number(r.quantity),
  avgPrice: Number(r.avg_price),
  buyDate: r.buy_date as string,
  stopLoss: num(r.stop_loss), target1: num(r.target1),
});
type Joined = Row & { instruments: Row | Row[] | null };
const toAlertRule = (r: Row, inst: Row): AlertRule => ({
  id: Number(r.id),
  instrumentId: Number(r.instrument_id),
  key: inst.key as string,
  name: inst.name as string,
  yahooTicker: inst.yahoo_ticker as string,
  condition: r.condition as AlertRule["condition"],
  value: num(r.value),
  mode: r.mode as AlertRule["mode"],
  active: r.active as boolean,
  source: r.source as AlertRule["source"],
  lastState: (r.last_state as boolean | null) ?? null,
  lastLevel: (r.last_level as AlertRule["lastLevel"]) ?? null,
  lastFiredAt: (r.last_fired_at as string | null) ?? null,
  createdAt: r.created_at as string,
});
const toAlertEvent = (r: Row, inst: Row): AlertEvent => ({
  id: Number(r.id),
  alertId: num(r.alert_id),
  instrumentId: Number(r.instrument_id),
  key: inst.key as string,
  name: inst.name as string,
  firedAt: r.fired_at as string,
  price: num(r.price),
  message: r.message as string,
  read: r.read as boolean,
  telegramStatus: (r.telegram_status as string | null) ?? null,
});
const oneInstrument = (v: Row | Row[] | null): Row | null => (Array.isArray(v) ? v[0] ?? null : v);
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

const toSnapshot = (r: Row): ScoreSnapshot => ({
  instrumentId: Number(r.instrument_id), symbol: r.symbol as string, evaluationDate: r.evaluation_date as string, scoringVersion: r.scoring_version as string,
  technicalScore: num(r.technical_score), tradeQualityScore: num(r.trade_quality_score), fundamentalScore: num(r.fundamental_score), dataConfidence: num(r.data_confidence),
  categoryBreakdown: r.category_breakdown, dataCoverage: r.data_coverage, dataTimestamp: r.data_timestamp as string, createdAt: r.created_at as string,
});
const toScoreRun = (r: Row): ScoreRun => ({
  id: Number(r.id), runDate: r.run_date as string, scoringVersion: r.scoring_version as string, status: r.status as ScoreRun["status"],
  total: Number(r.total), nextOffset: Number(r.next_offset), processed: Number(r.processed), failed: (r.failed as ScoreRun["failed"]) ?? [],
  batches: Number(r.batches), maxBatches: Number(r.max_batches), lockedUntil: (r.locked_until as string | null) ?? null,
  lastSuccessAt: (r.last_success_at as string | null) ?? null, finishedAt: (r.finished_at as string | null) ?? null, error: (r.error as string | null) ?? null,
});

const CHART_COLUMNS = "date,open,high,low,close,volume,ema20,ema50,ema200,bb_upper,bb_middle,bb_lower,rsi14,macd,macd_signal,macd_hist,score,score_label";

type PageResult = { data: unknown; error: { message: string } | null; count: number | null };
/**
 * Reads a large filtered result in as few sequential round trips as possible, however big it is.
 * The first wave requests `speculate` pages at once (page 0 also asks for the exact total); if the total shows more pages exist,
 * every remaining page is requested together as a second wave. Cost: at most two sequential steps. Requesting a page that turns
 * out to be empty is cheap; waiting a full round trip for the count before asking for page 2 is not (round trips dominate here).
 * Pass `speculate` as the number of pages the query is expected to fill. The caller's query needs a stable order so pages do
 * not overlap; `maxRows` caps how much is ever read.
 */
async function pagedAll(
  fetchPage: (from: number, to: number, withCount: boolean) => PromiseLike<PageResult>,
  what: string,
  maxRows = Infinity,
  speculate = 1,
): Promise<Row[]> {
  const ok = (r: PageResult) => check(r as { data: Row[]; error: { message: string } | null }, what);
  const firstStarts: number[] = [];
  for (let i = 0; i < Math.max(1, speculate) && i * PAGE < maxRows; i++) firstStarts.push(i * PAGE);
  const wave = await Promise.all(firstStarts.map((from) => fetchPage(from, from + PAGE - 1, from === 0)));
  const rows: Row[] = [];
  for (const r of wave) rows.push(...ok(r));
  const total = Math.min(wave[0]!.count ?? rows.length, maxRows);
  const covered = firstStarts.length * PAGE;
  if (total <= covered || rows.length < covered) return rows;
  const starts: number[] = [];
  for (let from = covered; from < total; from += PAGE) starts.push(from);
  const rest = await Promise.all(starts.map(async (from) => ok(await fetchPage(from, from + PAGE - 1, false))));
  return rows.concat(...rest);
}

const pagesFor = (rows: number) => Math.max(1, Math.min(4, Math.ceil(rows / PAGE)));
/** Calendar days between two YYYY-MM-DD dates (inclusive); 0 if either is malformed. */
const spanDays = (from: string, to: string) => {
  const d = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
  return Number.isFinite(d) ? Math.max(0, d) + 1 : 0;
};

export function createSupabaseRepo(db: SupabaseClient): Repo {
  const upsertDays = async (rows: Row[], what: string) => {
    const unique = dedupeLastWins(rows, (r) => `${r.instrument_id}|${r.date}`);
    for (const c of chunks(unique)) {
      check(await db.from("daily_prices").upsert(c, { onConflict: "instrument_id,date" }), what);
    }
  };
  const now = () => new Date().toISOString();
  /**
   * Newest `limit` rows of `columns`, ascending. Pages newest-first with .range() because PostgREST caps responses at 1000 rows.
   * All pages are requested at once: each round trip to the database is ~300 ms, so sequential pages added up to seconds.
   */
  const readDays = async (instrumentId: number, limit: number, columns: string, what: string): Promise<Row[]> => {
    if (limit <= PAGE) {
      // the common case (a pop-up's year, a strip's ten rows): exactly one request
      const page = check(
        await db.from("daily_prices").select(columns).eq("instrument_id", instrumentId).order("date", { ascending: false }).range(0, limit - 1),
        what,
      ) as unknown as Row[];
      return page.reverse();
    }
    // long history: the first page also reports how many rows exist, then only the pages that exist are requested, together
    // (it used to request every possible page up front, most of them empty)
    const rows = await pagedAll(
      (from, to, withCount) =>
        db.from("daily_prices").select(columns, withCount ? { count: "exact" } : undefined).eq("instrument_id", instrumentId)
          .order("date", { ascending: false }).range(from, Math.min(to, limit - 1)),
      what,
      limit,
      Math.min(3, pagesFor(limit)),
    );
    return rows.slice(0, limit).reverse();
  };

  return {
    async listInstruments(f) {
      const out: Instrument[] = [];
      for (let from = 0; ; from += PAGE) {
        let q = db.from("instruments").select("*").order("id");
        if (f?.types) q = q.in("type", f.types);
        if (f?.activeOnly) q = q.eq("active", true);
        const page = check(await q.range(from, from + PAGE - 1), "listInstruments") as Row[];
        for (const r of page) out.push(toInstrument(r));
        if (page.length < PAGE) break;
      }
      return out;
    },
    async getInstrumentByKey(key) {
      const r = check(await db.from("instruments").select("*").eq("key", key).maybeSingle(), "getInstrumentByKey");
      return r ? toInstrument(r as Row) : null;
    },
    async searchInstruments(q, limit, opts) {
      // Strip characters that are special in PostgREST filter syntax / LIKE patterns.
      const safe = q.replace(/[%_,()\\]/g, " ").trim();
      if (!safe) return [];
      let query = db.from("instruments").select("*");
      if (!opts?.includeIndices) query = query.eq("type", "stock");
      const rows = check(
        await query.or(`key.ilike.%${safe}%,name.ilike.%${safe}%`).order("key").limit(limit),
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
      return (await readDays(instrumentId, limit, "*", "getDays")).map(toDay);
    },
    async getPriceBars(instrumentId, limit) {
      return (await readDays(instrumentId, limit, "date,open,high,low,close,volume", "getPriceBars")).map(toBar);
    },
    async upsertIndicators(instrumentId, rows) {
      await upsertDays(
        rows.map((r) => ({
          instrument_id: instrumentId, date: r.date, pct_change: r.pctChange,
          ema20: r.ema20, ema50: r.ema50, ema200: r.ema200, rsi14: r.rsi14, rs_vs_nifty: r.rsVsNifty,
          macd: r.macd, macd_signal: r.macdSignal, macd_hist: r.macdHist,
          bb_upper: r.bbUpper, bb_middle: r.bbMiddle, bb_lower: r.bbLower,
          vol_avg20: r.volAvg20, high_52w: r.high52w, low_52w: r.low52w, patterns: r.patterns,
        })),
        "upsertIndicators",
      );
    },
    async upsertScore(instrumentId, row) {
      await upsertDays(
        [{
          instrument_id: instrumentId, date: row.date, rs_vs_sector: row.rsVsSector, score: row.score,
          score_components: row.scoreComponents, score_label: row.scoreLabel,
          score_confidence: row.scoreConfidence, score_signal: row.scoreSignal,
        }],
        "upsertScore",
      );
    },
    async replaceConstituents(indexKey, instrumentIds) {
      check(await db.from("index_constituents").delete().eq("index_key", indexKey), "replaceConstituents delete");
      for (const c of chunks([...new Set(instrumentIds)])) {
        check(
          await db.from("index_constituents").insert(c.map((id) => ({ index_key: indexKey, instrument_id: id }))),
          "replaceConstituents insert",
        );
      }
    },
    async listConstituents(indexKey) {
      const rows = check(
        await db.from("index_constituents").select("instruments(*)").eq("index_key", indexKey),
        "listConstituents",
      ) as unknown as { instruments: Row | Row[] | null }[];
      return rows
        .map((r) => (Array.isArray(r.instruments) ? r.instruments[0] : r.instruments))
        .filter((i): i is Row => !!i)
        .map(toInstrument);
    },
    async listMemberships() {
      const out: { indexKey: string; instrumentId: number }[] = [];
      for (let from = 0; ; from += PAGE) {
        const page = check(
          await db.from("index_constituents").select("index_key,instrument_id")
            .order("index_key").order("instrument_id").range(from, from + PAGE - 1),
          "listMemberships",
        ) as Row[];
        for (const r of page) out.push({ indexKey: r.index_key as string, instrumentId: Number(r.instrument_id) });
        if (page.length < PAGE) break;
      }
      return out;
    },
    async getDaysOn(instrumentIds, date) {
      const out = new Map<number, StoredDay>();
      for (const c of chunks([...new Set(instrumentIds)], 300)) {
        const rows = check(
          await db.from("daily_prices").select("*").eq("date", date).in("instrument_id", c),
          "getDaysOn",
        ) as Row[];
        for (const r of rows) out.set(Number(r.instrument_id), toDay(r));
      }
      return out;
    },
    async getDaysRange(instrumentIds, fromDate, toDate) {
      const out = new Map<number, StoredDay[]>();
      const parts = await Promise.all(chunks([...new Set(instrumentIds)], 300).map((c) =>
        pagedAll(
          (from, to, withCount) =>
            db.from("daily_prices").select("*", withCount ? { count: "exact" } : undefined).in("instrument_id", c)
              .gte("date", fromDate).lte("date", toDate).order("instrument_id").order("date").range(from, to),
          "getDaysRange",
          Infinity,
          pagesFor(c.length * Math.ceil(spanDays(fromDate, toDate) * (5 / 7))),
        ),
      ));
      for (const r of parts.flat()) {
        const id = Number(r.instrument_id);
        const list = out.get(id);
        if (list) list.push(toDay(r)); else out.set(id, [toDay(r)]);
      }
      return out;
    },
    async getRecentDays(instrumentIds, perInstrument, windowDays) {
      const out = new Map<number, StoredDay[]>();
      const ids = [...new Set(instrumentIds)];
      if (ids.length === 0) return out;
      const fromDate = addDays(istDate(new Date()), -(windowDays ?? Math.ceil(perInstrument * 1.5) + 10));
      const parts = await Promise.all(chunks(ids, 300).map((c) =>
        pagedAll(
          (from, to, withCount) =>
            db.from("daily_prices").select("*", withCount ? { count: "exact" } : undefined).in("instrument_id", c)
              .gte("date", fromDate).order("instrument_id").order("date").range(from, to),
          "getRecentDays",
          Infinity,
          pagesFor(c.length * perInstrument),
        ),
      ));
      for (const r of parts.flat()) {
        const id = Number(r.instrument_id);
        const list = out.get(id);
        if (list) list.push(toDay(r)); else out.set(id, [toDay(r)]);
      }
      for (const [id, list] of out) out.set(id, list.slice(-perInstrument));
      return out;
    },
    async getCloseEma200(instrumentIds, fromDate, sessions) {
      const ids = [...new Set(instrumentIds)];
      const parts = await Promise.all(chunks(ids, 300).map((c) =>
        pagedAll(
          (from, to, withCount) =>
            db.from("daily_prices").select("date,close,ema200", withCount ? { count: "exact" } : undefined).in("instrument_id", c)
              .gte("date", fromDate).order("instrument_id").order("date").range(from, to),
          "getCloseEma200",
          Infinity,
          pagesFor(c.length * sessions),
        ),
      ));
      return parts.flat().map((r) => ({ date: r.date as string, close: num(r.close), ema200: num(r.ema200) }));
    },
    async getChartDays(instrumentId, limit) {
      return (await readDays(instrumentId, limit, CHART_COLUMNS, "getChartDays")).map(toDay);
    },
    async getLevelsMany(instrumentIds) {
      const out = new Map<number, Levels>();
      const ids = [...new Set(instrumentIds)];
      for (const id of ids) out.set(id, toLevels(null));
      if (ids.length === 0) return out;
      const rows = check(await db.from("levels").select("*").in("instrument_id", ids), "getLevelsMany") as Row[];
      for (const r of rows) out.set(Number(r.instrument_id), toLevels(r));
      return out;
    },
    async listConstituentsMany(indexKeys) {
      const out = new Map<string, Instrument[]>(indexKeys.map((k) => [k, []]));
      if (indexKeys.length === 0) return out;
      const rows = check(
        await db.from("index_constituents").select("index_key, instruments(*)").in("index_key", indexKeys),
        "listConstituentsMany",
      ) as unknown as { index_key: string; instruments: Row | Row[] | null }[];
      for (const r of rows) {
        const i = Array.isArray(r.instruments) ? r.instruments[0] : r.instruments;
        if (i) out.get(r.index_key)?.push(toInstrument(i));
      }
      return out;
    },
    async listSnapshotSummaries(f) {
      // PostgREST JSON-path selects pull only the small parts of data_coverage; category_breakdown (the bulk) is never read.
      const cols = "instrument_id,symbol,evaluation_date,scoring_version,technical_score,trade_quality_score,fundamental_score,data_confidence,data_timestamp," +
        "tcov:data_coverage->technical->coverage,qcov:data_coverage->tradeQuality->coverage,qrank:data_coverage->tradeQuality->rankable," +
        "qobs:data_coverage->tradeQuality->>observation,cstat:data_coverage->confidence->>status,metrics:data_coverage->metrics,shares:data_coverage->categoryShares";
      const out: ScoreSnapshot[] = [];
      for (let from = 0; ; from += 500) {
        const page = check(
          await db.from("stock_score_snapshots").select(cols).eq("scoring_version", f.version).eq("evaluation_date", f.date).order("instrument_id").range(from, from + 499),
          "listSnapshotSummaries",
        ) as unknown as Row[];
        for (const r of page) {
          out.push({
            instrumentId: Number(r.instrument_id), symbol: r.symbol as string, evaluationDate: r.evaluation_date as string, scoringVersion: r.scoring_version as string,
            technicalScore: num(r.technical_score), tradeQualityScore: num(r.trade_quality_score), fundamentalScore: num(r.fundamental_score), dataConfidence: num(r.data_confidence),
            categoryBreakdown: {},
            dataCoverage: {
              technical: { coverage: r.tcov }, tradeQuality: { coverage: r.qcov, rankable: r.qrank, observation: r.qobs },
              confidence: { status: r.cstat }, metrics: r.metrics, categoryShares: r.shares,
            },
            dataTimestamp: r.data_timestamp as string,
          });
        }
        if (page.length < 500) return out;
      }
    },
    async getOhlcvRange(instrumentIds, fromDate, toDate) {
      const out = new Map<number, OhlcvDay[]>();
      // ~20 ids x ~30 sessions fits one page, so the chunks run in parallel instead of paging one after another
      await Promise.all(chunks([...new Set(instrumentIds)], OHLCV_CHUNK).map(async (c) => {
        for (let from = 0; ; from += PAGE) {
          const page = check(
            await db.from("daily_prices").select(OHLCV_COLUMNS).in("instrument_id", c)
              .gte("date", fromDate).lte("date", toDate)
              .order("instrument_id").order("date").range(from, from + PAGE - 1),
            "getOhlcvRange",
          ) as unknown as Row[];
          for (const r of page) {
            const id = Number(r.instrument_id);
            const { date, open, high, low, close, volume, pctChange, importedPct } = toDay(r);
            const day = { date, open, high, low, close, volume, pctChange, importedPct };
            const list = out.get(id);
            if (list) list.push(day); else out.set(id, [day]);
          }
          if (page.length < PAGE) break;
        }
      }));
      return out;
    },
    async getLatestDay(instrumentId) {
      const r = check(
        await db.from("daily_prices").select("*").eq("instrument_id", instrumentId)
          .not("close", "is", null).order("date", { ascending: false }).limit(1).maybeSingle(),
        "getLatestDay",
      );
      return r ? toDay(r as Row) : null;
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
    async listHoldings() {
      const rows = check(
        await db.from("holdings").select("*, instruments(*)").order("created_at").order("instrument_id"),
        "listHoldings",
      ) as unknown as (Row & { instruments: Row | Row[] | null })[];
      return rows.flatMap((r) => {
        const inst = oneInstrument(r.instruments);
        return inst ? [toHolding(r, inst)] : [];
      });
    },
    async getHolding(instrumentId) {
      const r = check(
        await db.from("holdings").select("*, instruments(*)").eq("instrument_id", instrumentId).maybeSingle(),
        "getHolding",
      ) as unknown as (Row & { instruments: Row | Row[] | null }) | null;
      const inst = r ? oneInstrument(r.instruments) : null;
      return r && inst ? toHolding(r, inst) : null;
    },
    async upsertHolding(instrumentId, h: HoldingInput) {
      check(
        await db.from("holdings").upsert(
          {
            instrument_id: instrumentId, quantity: h.qty, avg_price: h.avgPrice, buy_date: h.buyDate,
            stop_loss: h.stopLoss, target1: h.target1, updated_at: now(),
          },
          { onConflict: "instrument_id" },
        ),
        "upsertHolding",
      );
    },
    async deleteHolding(instrumentId) {
      check(await db.from("holdings").delete().eq("instrument_id", instrumentId), "deleteHolding");
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
    async startJobRun(job, startedAt) {
      const r = check(
        await db.from("job_runs").insert({ job, started_at: startedAt, status: "running", message: "" }).select("id").single(),
        "startJobRun",
      ) as Row;
      return Number(r.id);
    },
    async finishJobRun(id, result) {
      check(
        await db.from("job_runs")
          .update({ finished_at: result.finishedAt, status: result.status, message: result.message })
          .eq("id", id),
        "finishJobRun",
      );
    },
    async lastJobRun(job) {
      const r = check(
        await db.from("job_runs").select("*").eq("job", job).order("started_at", { ascending: false }).limit(1).maybeSingle(),
        "lastJobRun",
      );
      return r ? toJobRun(r as Row) : null;
    },
    async requestReport(instrumentId) {
      const r = check(
        await db.from("reports").insert({ instrument_id: instrumentId, status: "pending", requested_via: "site" })
          .select("*").single(),
        "requestReport",
      );
      return toReport(r as Row);
    },
    async listReports(instrumentId) {
      const rows = check(
        await db.from("reports").select("*").eq("instrument_id", instrumentId)
          .order("requested_at", { ascending: false }).order("id", { ascending: false }),
        "listReports",
      ) as Row[];
      return rows.map(toReport);
    },
    async listAllReports() {
      const rows = check(
        await db.from("reports").select("*, instruments(key,name)")
          .order("requested_at", { ascending: false }).order("id", { ascending: false }),
        "listAllReports",
      ) as Row[];
      return rows.map((r): ReportWithStock => {
        const inst = r.instruments as { key: string; name: string } | null;
        return { ...toReport(r), key: inst?.key ?? "", name: inst?.name ?? "" };
      });
    },
    async deleteReport(id) {
      check(await db.from("reports").delete().eq("id", id), "deleteReport");
    },
    async upsertDelivery(rows) {
      for (const c of chunks(rows)) {
        check(
          await db.from("delivery_daily").upsert(c.map((r) => ({
            symbol: r.symbol, date: r.date, turnover_lacs: r.turnoverLacs, traded_qty: r.tradedQty, deliv_qty: r.delivQty,
            deliv_per: r.delivPer, close: r.close, turnover_rank: r.turnoverRank,
          }))),
          "upsertDelivery",
        );
      }
    },
    async listDelivery(sinceDate) {
      const out: DeliveryRow[] = [];
      for (let from = 0; ; from += PAGE) {
        const page = check(
          await db.from("delivery_daily").select("*").gte("date", sinceDate).order("date").order("turnover_rank").range(from, from + PAGE - 1),
          "listDelivery",
        ) as Row[];
        for (const r of page) {
          out.push({
            symbol: r.symbol as string, date: r.date as string, turnoverLacs: Number(r.turnover_lacs), tradedQty: num(r.traded_qty),
            delivQty: num(r.deliv_qty), delivPer: Number(r.deliv_per), close: num(r.close), turnoverRank: Number(r.turnover_rank),
          });
        }
        if (page.length < PAGE) return out;
      }
    },
    async getDailySummary(date) {
      const r = check(await db.from("daily_summaries").select("*").eq("date", date).maybeSingle(), "getDailySummary");
      return r ? toSummary(r as Row) : null;
    },
    async listAlertRules(f) {
      let q = db.from("alerts").select("*, instruments(key, name, yahoo_ticker)").order("id");
      if (f?.activeOnly) q = q.eq("active", true);
      if (f?.conditions) q = q.in("condition", f.conditions);
      const rows = check(await q, "listAlertRules") as unknown as Joined[];
      return rows.flatMap((r) => {
        const inst = oneInstrument(r.instruments);
        return inst ? [toAlertRule(r, inst)] : [];
      });
    },
    async createAlertRule(r) {
      const row = check(
        await db.from("alerts").insert({
          instrument_id: r.instrumentId, condition: r.condition, value: r.value, mode: r.mode, source: r.source,
          last_state: r.lastState, last_level: r.lastLevel,
        }).select("*, instruments(key, name, yahoo_ticker)").single(),
        "createAlertRule",
      ) as unknown as Joined;
      const inst = oneInstrument(row.instruments);
      if (!inst) throw new Error("createAlertRule: instrument missing");
      return toAlertRule(row, inst);
    },
    async setAlertActive(id, active) {
      check(await db.from("alerts").update({ active }).eq("id", id), "setAlertActive");
    },
    async deleteAlertRule(id) {
      check(await db.from("alerts").delete().eq("id", id), "deleteAlertRule");
    },
    async saveAlertStates(updates) {
      if (updates.length === 0) return;
      // PostgREST can't update many rows to different values in one call; read the rows, then upsert them whole.
      const ids = updates.map((u) => u.id);
      const current = new Map(
        (check(await db.from("alerts").select("*").in("id", ids), "saveAlertStates read") as Row[]).map((r) => [Number(r.id), r]),
      );
      const rows = updates.flatMap((u) => {
        const r = current.get(u.id);
        if (!r) return [];
        const rest = { ...r };
        delete rest.created_at;
        return [{
          ...rest,
          last_state: u.lastState,
          last_level: u.lastLevel,
          ...(u.lastFiredAt !== undefined && { last_fired_at: u.lastFiredAt }),
          ...(u.active !== undefined && { active: u.active }),
          ...(u.value !== undefined && { value: u.value }),
        }];
      });
      for (const c of chunks(rows)) check(await db.from("alerts").upsert(c, { onConflict: "id" }), "saveAlertStates");
    },
    async insertAlertEvents(events) {
      if (events.length === 0) return;
      check(
        await db.from("alert_events").insert(events.map((e) => ({
          alert_id: e.alertId, instrument_id: e.instrumentId, fired_at: e.firedAt, price: e.price,
          message: e.message, telegram_status: e.telegramStatus,
        }))),
        "insertAlertEvents",
      );
    },
    async listAlertEvents(limit) {
      const rows = check(
        await db.from("alert_events").select("*, instruments(key, name)")
          .order("read").order("fired_at", { ascending: false }).order("id", { ascending: false }).limit(limit),
        "listAlertEvents",
      ) as unknown as Joined[];
      return rows.flatMap((r) => {
        const inst = oneInstrument(r.instruments);
        return inst ? [toAlertEvent(r, inst)] : [];
      });
    },
    async unreadAlertCount() {
      const res = await db.from("alert_events").select("id", { count: "exact", head: true }).eq("read", false);
      if (res.error) throw new Error(`unreadAlertCount: ${res.error.message}`);
      return res.count ?? 0;
    },
    async markAlertsRead(ids) {
      if (ids === "all") {
        check(await db.from("alert_events").update({ read: true }).eq("read", false), "markAlertsRead");
      } else if (ids.length > 0) {
        check(await db.from("alert_events").update({ read: true }).in("id", ids), "markAlertsRead");
      }
    },
    async listShareholding(quarterEnds, instrumentIds) {
      if (quarterEnds.length === 0 || instrumentIds?.length === 0) return [];
      let q = db.from("shareholding").select("*").in("quarter_end", quarterEnds);
      if (instrumentIds) q = q.in("instrument_id", instrumentIds);
      const rows = check(await q, "listShareholding") as Row[];
      return rows.map(toShareholding);
    },
    async latestShareholdingQuarter() {
      const r = check(
        await db.from("shareholding").select("quarter_end").order("quarter_end", { ascending: false }).limit(1).maybeSingle(),
        "latestShareholdingQuarter",
      ) as Row | null;
      return r ? (r.quarter_end as string) : null;
    },
    async upsertShareholding(rows) {
      if (rows.length === 0) return;
      check(
        await db.from("shareholding").upsert(rows.map((r) => ({
          instrument_id: r.instrumentId, quarter_end: r.quarterEnd, fii_pct: r.fiiPct, dii_pct: r.diiPct,
          promoter_pct: r.promoterPct, source_url: r.sourceUrl,
        }))),
        "upsertShareholding",
      );
    },
    async upsertSnapshots(rows) {
      for (const c of chunks(rows, 100)) {
        check(
          await db.from("stock_score_snapshots").upsert(
            c.map((r) => ({
              instrument_id: r.instrumentId, symbol: r.symbol, evaluation_date: r.evaluationDate, scoring_version: r.scoringVersion,
              technical_score: r.technicalScore, trade_quality_score: r.tradeQualityScore, fundamental_score: r.fundamentalScore,
              data_confidence: r.dataConfidence, category_breakdown: r.categoryBreakdown, data_coverage: r.dataCoverage, data_timestamp: r.dataTimestamp,
            })),
            { onConflict: "instrument_id,evaluation_date,scoring_version" },
          ),
          "upsertSnapshots",
        );
      }
    },
    async listSnapshots(f) {
      const out: ScoreSnapshot[] = [];
      for (let from = 0; ; from += 500) {
        const page = check(
          await db.from("stock_score_snapshots").select("*").eq("scoring_version", f.version).eq("evaluation_date", f.date).order("instrument_id").range(from, from + 499),
          "listSnapshots",
        ) as Row[];
        for (const r of page) out.push(toSnapshot(r));
        if (page.length < 500) return out;
      }
    },
    async getScoreRun(runDate, version) {
      const r = check(await db.from("score_runs").select("*").eq("run_date", runDate).eq("scoring_version", version).maybeSingle(), "getScoreRun") as Row | null;
      return r ? toScoreRun(r) : null;
    },
    async ensureScoreRun(runDate, version, total, maxBatches) {
      check(
        await db.from("score_runs").upsert({ run_date: runDate, scoring_version: version, total, max_batches: maxBatches }, { onConflict: "run_date,scoring_version", ignoreDuplicates: true }),
        "ensureScoreRun",
      );
      return toScoreRun(check(await db.from("score_runs").select("*").eq("run_date", runDate).eq("scoring_version", version).single(), "ensureScoreRun") as Row);
    },
    async claimScoreRun(runDate, version, now, leaseMs) {
      const cur = check(await db.from("score_runs").select("*").eq("run_date", runDate).eq("scoring_version", version).maybeSingle(), "claimScoreRun") as Row | null;
      if (!cur) return { claimed: false, run: null };
      const run = toScoreRun(cur);
      if (run.status === "completed" || run.status === "failed") return { claimed: false, run };
      if (run.lockedUntil !== null && Date.parse(run.lockedUntil) > now.getTime()) return { claimed: false, run };
      if (run.batches >= run.maxBatches) {
        check(await db.from("score_runs").update({ status: "failed", error: `Batch allowance of ${run.maxBatches} used up before the run finished`, finished_at: now.toISOString() }).eq("id", run.id), "claimScoreRun");
        return { claimed: false, run: { ...run, status: "failed" } };
      }
      // Optimistic claim: only succeeds if nobody changed batches since we read it.
      const got = check(
        await db.from("score_runs").update({ batches: run.batches + 1, status: "running", locked_until: new Date(now.getTime() + leaseMs).toISOString() }).eq("id", run.id).eq("batches", run.batches).select(),
        "claimScoreRun",
      ) as Row[];
      return got.length === 1 ? { claimed: true, run: toScoreRun(got[0]!) } : { claimed: false, run };
    },
    async saveScoreRun(run) {
      check(
        await db.from("score_runs").update({
          status: run.status, next_offset: run.nextOffset, processed: run.processed, failed: run.failed, total: run.total,
          last_success_at: run.lastSuccessAt, finished_at: run.finishedAt, error: run.error, locked_until: null,
        }).eq("id", run.id),
        "saveScoreRun",
      );
    },
    async latestSnapshotDate(version) {
      const r = check(
        await db.from("stock_score_snapshots").select("evaluation_date").eq("scoring_version", version).order("evaluation_date", { ascending: false }).limit(1).maybeSingle(),
        "latestSnapshotDate",
      ) as Row | null;
      return r ? (r.evaluation_date as string) : null;
    },
    async getSnapshot(instrumentId, version, date) {
      let q = db.from("stock_score_snapshots").select("*").eq("instrument_id", instrumentId).eq("scoring_version", version);
      if (date) q = q.eq("evaluation_date", date);
      const r = check(await q.order("evaluation_date", { ascending: false }).limit(1).maybeSingle(), "getSnapshot") as Row | null;
      return r ? toSnapshot(r) : null;
    },
    async listSnapshotsRange(version, fromDate, toDate) {
      const out: ScoreSnapshot[] = [];
      for (let from = 0; ; from += 500) {
        const page = check(
          await db.from("stock_score_snapshots").select("*").eq("scoring_version", version).gte("evaluation_date", fromDate).lte("evaluation_date", toDate)
            .order("evaluation_date").order("instrument_id").range(from, from + 499),
          "listSnapshotsRange",
        ) as Row[];
        for (const r of page) out.push(toSnapshot(r));
        if (page.length < 500) return out;
      }
    },
  };
}
