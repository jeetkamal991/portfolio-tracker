import type { Repo } from "@/lib/db/repo";
import type { Instrument, StoredDay } from "@/lib/db/types";
import type { PatternHit } from "@/lib/calc/patterns";
import { scoreInstrument, type InstrumentKind, type ScoreLabel } from "@/lib/calc/score";
import { effectiveLevel } from "@/lib/calc/levels";
import { primarySector } from "@/lib/universe/sectors";
import { pool } from "./pool";

const DAYS_NEEDED = 40; // 21 priced closes plus slack for unpriced rows
const RETURN_SESSIONS = 20;
const CONCURRENCY = 8;
const NIFTY_KEY = "NIFTY50";
/** Volatility gauge, not a tradable trend: a technical score would read backwards. */
const UNSCORED = new Set(["INDIAVIX"]);

interface Loaded {
  priced: StoredDay[];
  ret20: number | null;
}

async function load(repo: Repo, id: number): Promise<Loaded> {
  const days = await repo.getDays(id, DAYS_NEEDED);
  const priced = days.filter((d) => d.close !== null);
  let ret20: number | null = null;
  if (priced.length > RETURN_SESSIONS) {
    const last = priced[priced.length - 1]!.close as number;
    const base = priced[priced.length - 1 - RETURN_SESSIONS]!.close as number;
    if (base !== 0) ret20 = last / base - 1;
  }
  return { priced, ret20 };
}

const kindOf = (i: Instrument): InstrumentKind =>
  i.key === "NIFTY50" ? "nifty" : i.type === "sector" ? "sector" : i.type === "index" ? "index" : "stock";

interface Ctx {
  niftyLabel: ScoreLabel | null;
  sectorLabel: ScoreLabel | null;
  rsVsSector: number | null;
  support: number | null;
  resistance: number | null;
}

export interface ScorePassResult {
  scored: number;
  /** Instruments with no priced day (including a missing NIFTY50). */
  skipped: string[];
  /** "KEY (error)" for instruments whose load or write threw; the pass carries on without them. */
  failed: string[];
}

/**
 * Scores the latest priced session of Nifty, then indices/sectors, then stocks (dependency order:
 * each phase finishes before the next starts; instruments within a phase run concurrently).
 */
export async function scorePass(
  repo: Repo,
  opts: { onlyIds?: Set<number> } = {},
): Promise<ScorePassResult> {
  const only = opts.onlyIds;
  const skipped: string[] = [];
  const failed: string[] = [];
  let scored = 0;
  const fail = (key: string, e: unknown) => failed.push(`${key} (${e instanceof Error ? e.message : String(e)})`);

  const keysOf = new Map<number, string[]>();
  for (const m of await repo.listMemberships()) {
    const l = keysOf.get(m.instrumentId) ?? [];
    l.push(m.indexKey);
    keysOf.set(m.instrumentId, l);
  }
  const sectorOf = (id: number) => primarySector(keysOf.get(id) ?? []);

  const all = await repo.listInstruments({ types: ["index", "sector"], activeOnly: true });
  const nifty = all.find((i) => i.key === NIFTY_KEY);
  const others = all.filter((i) => i.key !== NIFTY_KEY && !UNSCORED.has(i.key));

  // Computes the score; stores it unless an onlyIds filter excludes this instrument (its label is
  // still needed by dependants). Returns the label, or null when there is no priced day.
  const run = async (inst: Instrument, data: Loaded, ctx: Ctx): Promise<ScoreLabel | null> => {
    const { priced } = data;
    const latest = priced[priced.length - 1];
    if (!latest) {
      skipped.push(inst.key);
      return null;
    }
    const prev = priced[priced.length - 2] ?? null;
    const recentPatterns: PatternHit[] = priced.slice(-3).flatMap((d) => d.patterns ?? []);
    const r = scoreInstrument({
      kind: kindOf(inst),
      close: latest.close as number,
      prevClose: prev ? prev.close : null,
      ema20: latest.ema20, ema50: latest.ema50, ema200: latest.ema200,
      rsi14: latest.rsi14,
      macd: latest.macd, macdSignal: latest.macdSignal, macdHist: latest.macdHist,
      prevMacdHist: prev ? prev.macdHist : null,
      volume: latest.volume, volAvg20: latest.volAvg20,
      recentPatterns,
      niftyLabel: ctx.niftyLabel,
      sectorLabel: ctx.sectorLabel,
      rs20: latest.rsVsNifty,
      support: ctx.support,
      resistance: ctx.resistance,
    });
    if (!only || only.has(inst.id)) {
      await repo.upsertScore(inst.id, {
        date: latest.date,
        rsVsSector: ctx.rsVsSector,
        score: r.score,
        scoreComponents: { ...r.components, partial: r.partial },
        scoreLabel: r.label,
        scoreConfidence: r.confidence,
        scoreSignal: r.signal,
      });
      scored++;
    }
    return r.label;
  };

  const none = { rsVsSector: null, support: null, resistance: null };

  // 1. Nifty.
  let niftyLabel: ScoreLabel | null = null;
  if (!nifty) skipped.push(NIFTY_KEY);
  else {
    try {
      niftyLabel = await run(nifty, await load(repo, nifty.id), { ...none, niftyLabel: null, sectorLabel: null });
    } catch (e) {
      fail(nifty.key, e);
    }
  }

  // 2. Indices and sectors (their market context is Nifty's label).
  const sectorInfo = new Map<string, { label: ScoreLabel | null; ret20: number | null }>();
  await pool(others, CONCURRENCY, async (inst) => {
    try {
      const data = await load(repo, inst.id);
      const label = await run(inst, data, { ...none, niftyLabel, sectorLabel: niftyLabel });
      sectorInfo.set(inst.key, { label, ret20: data.ret20 });
    } catch (e) {
      fail(inst.key, e);
    }
  });

  // 3. Stocks: NIFTY200 plus watchlist.
  const stocks = new Map<number, Instrument>();
  for (const s of await repo.listConstituents("NIFTY200")) stocks.set(s.id, s);
  for (const s of await repo.listWatchlist()) stocks.set(s.id, s);
  const todo = [...stocks.values()].filter((s) => s.type === "stock" && s.active && (!only || only.has(s.id)));
  await pool(todo, CONCURRENCY, async (s) => {
    try {
      const [data, lv] = await Promise.all([load(repo, s.id), repo.getLevels(s.id)]);
      const sec = sectorOf(s.id);
      const info = sec ? sectorInfo.get(sec) : undefined;
      const sectorRet = info?.ret20 ?? null;
      await run(s, data, {
        niftyLabel,
        sectorLabel: info?.label ?? null,
        rsVsSector: data.ret20 !== null && sectorRet !== null ? data.ret20 - sectorRet : null,
        support: effectiveLevel(lv.autoSupport, lv.manualSupport),
        resistance: effectiveLevel(lv.autoResistance, lv.manualResistance),
      });
    } catch (e) {
      fail(s.key, e);
    }
  });

  return { scored, skipped, failed };
}
