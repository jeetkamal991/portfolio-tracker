import { ALPHAS, type AlphaId } from "@/lib/calc/alpha/alphas";
import { caveats } from "@/lib/calc/backtest/caveats";
import { NSE_COSTS } from "@/lib/calc/backtest/costs";
import { runEngine, type EngineResult, type EngineSettings } from "@/lib/calc/backtest/engine";
import { computeMetrics } from "@/lib/calc/backtest/metrics";
import {
  alphaStrategy, holdStrategy, randomStrategy, RULE_IDS, ruleStrategy, type RuleId, type StockSeries, type Strategy,
} from "@/lib/calc/backtest/strategy";
import type { Repo } from "@/lib/db/repo";
import type { BacktestRunInput, Instrument, OhlcvDay, StoredDay } from "@/lib/db/types";
import { addDays } from "@/lib/time/ist";

export type StrategySpec =
  | { kind: "alpha"; alpha: AlphaId; top: number }
  | { kind: "rule"; rule: RuleId }
  | { kind: "hold"; key: string }
  | { kind: "random"; seed: number };

export interface BacktestOptions {
  spec: StrategySpec;
  name: string;
  from: string;
  maxPositions: number;
  holdSessions: number;
  stopPct: number | null;
  capital: number;
  dryRun: boolean;
}

const FAR = "9999-12-31";
const MIN_SESSIONS = 60;
const HISTORY_BUFFER_DAYS = 60; // history before `from` so the first windows are full
const CHUNK = 10;
const WIDE_CHUNK = 4; // `select *` rows are heavy: ten ids of them over seven years dropped the connection
const ATTEMPTS = 3;
const IN_FLIGHT = 5;
const BIG_MOVE = 0.35; // a close-to-close move this large is a sign of an unadjusted split

const VALUE_FLAGS = new Set(["alpha", "top", "rule", "key", "seed", "hold", "stop", "from", "max-positions", "capital", "name"]);
const ALPHA_IDS = ALPHAS.map((a) => a.id);

/** `argv` is what follows `npm run backtest --`. Throws an Error with a readable message on anything wrong. */
export function parseBacktestArgs(argv: string[]): BacktestOptions {
  const kind = argv[0];
  if (!kind || kind.startsWith("--")) throw new Error("Say which strategy: alpha, rule, hold or random.");
  if (!["alpha", "rule", "hold", "random"].includes(kind)) throw new Error(`Unknown strategy "${kind}". Use alpha, rule, hold or random.`);

  const values = new Map<string, string>();
  let dryRun = false;
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) throw new Error(`Unexpected argument "${arg}".`);
    const name = arg.slice(2);
    if (name === "dry-run") { dryRun = true; continue; }
    if (!VALUE_FLAGS.has(name)) throw new Error(`Unknown option --${name}.`);
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) throw new Error(`--${name} needs a value.`);
    values.set(name, v);
    i++;
  }
  const whole = (name: string, def: number): number => {
    const v = values.get(name);
    if (v === undefined) return def;
    if (!/^\d+$/.test(v) || Number(v) < 1) throw new Error(`--${name} must be a whole number of 1 or more.`);
    return Number(v);
  };

  let spec: StrategySpec;
  if (kind === "alpha") {
    const a = values.get("alpha");
    if (a === undefined) throw new Error(`alpha needs --alpha (one of ${ALPHA_IDS.join(", ")}).`);
    if (!ALPHA_IDS.includes(a as AlphaId)) throw new Error(`Unknown alpha "${a}". Valid: ${ALPHA_IDS.join(", ")}.`);
    spec = { kind, alpha: a as AlphaId, top: whole("top", 10) };
  } else if (kind === "rule") {
    const r = values.get("rule");
    if (r === undefined) throw new Error(`rule needs --rule (one of ${RULE_IDS.join(", ")}).`);
    if (!(RULE_IDS as readonly string[]).includes(r)) throw new Error(`Unknown rule "${r}". Valid: ${RULE_IDS.join(", ")}.`);
    spec = { kind, rule: r as RuleId };
  } else if (kind === "hold") {
    const key = values.get("key");
    if (key === undefined) throw new Error("hold needs --key (an instrument key such as NIFTY50).");
    spec = { kind, key };
  } else {
    spec = { kind: "random", seed: whole("seed", 1) };
  }

  const from = values.get("from") ?? "2020-01-01";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) throw new Error("--from must be a date like 2020-01-01.");
  const stopRaw = values.get("stop");
  const stopPct = stopRaw === undefined ? null : Number(stopRaw);
  if (stopPct !== null && !(Number.isFinite(stopPct) && stopPct > 0 && stopPct < 100)) throw new Error("--stop must be a percent between 0 and 100.");

  const holdSessions = whole("hold", 5);
  const label = spec.kind === "alpha" ? `alpha ${spec.alpha} top ${spec.top}`
    : spec.kind === "rule" ? `rule ${spec.rule}`
    : spec.kind === "hold" ? `hold ${spec.key}`
    : `random seed ${spec.seed}`;
  return {
    spec, from, holdSessions, stopPct, dryRun,
    maxPositions: whole("max-positions", 10),
    capital: whole("capital", 1000000),
    name: values.get("name") ?? `${label}, hold ${holdSessions}${stopPct === null ? "" : `, stop ${stopPct}%`}`,
  };
}

async function withRetry<T>(fn: () => Promise<T>, delayMs: number): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (attempt >= ATTEMPTS) throw e;
      await new Promise((r) => setTimeout(r, delayMs * attempt));
    }
  }
}

/**
 * Rows for many instruments, fetched in parallel chunks: a long history is slow to read one page after another.
 * A chunk whose request fails is tried again, up to three times.
 */
export async function loadHistory<D extends OhlcvDay>(
  repo: Repo, ids: number[], from: string, to: string, wide: boolean, retryDelayMs = 1000,
): Promise<Map<number, D[]>> {
  const size = wide ? WIDE_CHUNK : CHUNK;
  const chunks: number[][] = [];
  for (let i = 0; i < ids.length; i += size) chunks.push(ids.slice(i, i + size));
  const out = new Map<number, D[]>();
  for (let i = 0; i < chunks.length; i += IN_FLIGHT) {
    const batch = await Promise.all(
      chunks.slice(i, i + IN_FLIGHT).map((c) =>
        withRetry(() => (wide ? repo.getDaysRange(c, from, to) : repo.getOhlcvRange(c, from, to)), retryDelayMs)),
    );
    for (const m of batch) for (const [id, rows] of m) out.set(id, rows as D[]);
  }
  return out;
}

export interface DataReport {
  stocks: number;
  firstDate: string | null;
  lastDate: string | null;
  /** Close-to-close moves of 35% or more either way, largest first (first 50). */
  bigMoves: { key: string; date: string; pct: number }[];
  /** Share of rows with a stored score; null when the rows carry no score column. */
  scoreCoverage: number | null;
}

export function dataReport(stocks: StockSeries<OhlcvDay & { score?: number | null }>[]): DataReport {
  let first: string | null = null;
  let last: string | null = null;
  let withScore = 0;
  let scored = 0;
  let counted = 0;
  const bigMoves: DataReport["bigMoves"] = [];
  for (const s of stocks) {
    if (s.days.length > 0) counted++;
    s.days.forEach((d, i) => {
      if (first === null || d.date < first) first = d.date;
      if (last === null || d.date > last) last = d.date;
      if ("score" in d) { withScore++; if (d.score != null) scored++; }
      const prev = s.days[i - 1]?.close;
      if (d.close != null && prev != null && prev > 0) {
        const pct = d.close / prev - 1;
        if (Math.abs(pct) >= BIG_MOVE) bigMoves.push({ key: s.key, date: d.date, pct });
      }
    });
  }
  bigMoves.sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));
  return { stocks: counted, firstDate: first, lastDate: last, bigMoves: bigMoves.slice(0, 50), scoreCoverage: withScore ? scored / withScore : null };
}

function strategyOf(spec: Exclude<StrategySpec, { kind: "rule" }>): Strategy {
  if (spec.kind === "alpha") return alphaStrategy(spec.alpha, spec.top);
  if (spec.kind === "hold") return holdStrategy(spec.key);
  return randomStrategy(spec.seed);
}

/** Runs the engine over the stored history and builds the run, without saving it. */
export async function runBacktest(repo: Repo, opts: BacktestOptions): Promise<{ run: BacktestRunInput; report: DataReport; tradedValue: number }> {
  const nifty = await repo.getInstrumentByKey("NIFTY50");
  if (!nifty) throw new Error("NIFTY50 is not in the database.");
  const niftyRows = (await repo.getOhlcvRange([nifty.id], opts.from, FAR)).get(nifty.id) ?? [];
  const priced = niftyRows.filter((d) => d.close != null && d.close > 0);
  if (priced.length < MIN_SESSIONS) {
    throw new Error(`Not enough Nifty 50 history from ${opts.from}: ${priced.length} sessions, need at least ${MIN_SESSIONS}.`);
  }
  const calendar = priced.map((d) => d.date);

  let universe: Instrument[];
  if (opts.spec.kind === "hold") {
    const held = await repo.getInstrumentByKey(opts.spec.key);
    if (!held) throw new Error(`Unknown instrument "${opts.spec.key}".`);
    universe = [held];
  } else {
    universe = await repo.listConstituents("NIFTY200");
    if (universe.length === 0) throw new Error("No Nifty 200 constituents are imported.");
  }
  const ids = universe.map((u) => u.id);
  const loadFrom = addDays(opts.from, -HISTORY_BUFFER_DAYS);
  const settings: EngineSettings = {
    capital: opts.capital, maxPositions: opts.maxPositions, holdSessions: opts.holdSessions, stopPct: opts.stopPct, costs: NSE_COSTS,
  };

  let engine: EngineResult;
  let report: DataReport;
  let strategy: Pick<Strategy, "id" | "label" | "params">;
  if (opts.spec.kind === "rule") {
    const hist = await loadHistory<StoredDay>(repo, ids, loadFrom, FAR, true);
    const stocks = universe.map((u) => ({ key: u.key, name: u.name, days: hist.get(u.id) ?? [] }));
    strategy = ruleStrategy(opts.spec.rule);
    engine = runEngine(stocks, calendar, ruleStrategy(opts.spec.rule), settings);
    report = dataReport(stocks);
  } else {
    const hist = await loadHistory<OhlcvDay>(repo, ids, loadFrom, FAR, false);
    const stocks = universe.map((u) => ({ key: u.key, name: u.name, days: hist.get(u.id) ?? [] }));
    strategy = strategyOf(opts.spec);
    engine = runEngine(stocks, calendar, strategyOf(opts.spec), settings);
    report = dataReport(stocks);
  }

  // benchmark: Nifty 50 buy-and-hold, price only, scaled to the same starting capital
  const bench = priced.map((d) => (opts.capital * (d.close as number)) / (priced[0].close as number));
  const run: BacktestRunInput = {
    name: opts.name,
    strategy: { id: strategy.id, label: strategy.label, params: strategy.params },
    settings: {
      capital: opts.capital, maxPositions: opts.maxPositions, holdSessions: opts.holdSessions, stopPct: opts.stopPct,
      from: calendar[0], to: calendar[calendar.length - 1],
    },
    metrics: {
      strategy: computeMetrics(engine.days, engine.trades, engine.tradedValue),
      benchmark: computeMetrics(calendar.map((date, i) => ({ date, equity: bench[i] }))),
    },
    equity: engine.days.map((d, i) => [d.date, d.equity, bench[i]]),
    trades: engine.trades,
    dataThrough: calendar[calendar.length - 1],
    universeNote: opts.spec.kind === "hold"
      ? `Single instrument ${opts.spec.key}.`
      : "Today's Nifty 200 members only (survivorship bias).",
  };
  return { run, report, tradedValue: engine.tradedValue };
}

/** Runs, then saves unless it is a dry run. A run that fails saves nothing. */
export async function backtestAndSave(repo: Repo, opts: BacktestOptions) {
  const r = await runBacktest(repo, opts);
  const id = opts.dryRun ? null : await repo.saveBacktestRun(r.run);
  return { ...r, id };
}

const pct = (v: number | null) => (v === null ? "-" : `${v < 0 ? "-" : "+"}${(Math.abs(v) * 100).toFixed(1)}%`);
const plain = (v: number | null) => (v === null ? "-" : `${(v * 100).toFixed(1)}%`); // a level, not a change
const num = (v: number | null) => (v === null ? "-" : v.toFixed(2));

/** The text the command prints: data report, strategy against Nifty 50, caveats. */
export function formatRun(run: BacktestRunInput, report: DataReport): string {
  const s = run.metrics.strategy;
  const b = run.metrics.benchmark;
  const row = (label: string, x: string, y: string) => `${label.padEnd(18)}${x.padStart(12)}${y.padStart(12)}`;
  const s2 = run.settings;
  const lines = [
    run.name,
    `${s2.from} to ${s2.to}; up to ${s2.maxPositions} positions, hold ${s2.holdSessions} sessions` +
      `${s2.stopPct === null ? "" : `, stop ${s2.stopPct}%`}; capital ${s2.capital}`,
    `Data: ${report.stocks} stocks, ${report.firstDate ?? "-"} to ${report.lastDate ?? "-"}; ` +
      `${report.bigMoves.length} moves of 35% or more` +
      `${report.bigMoves.length ? ` (${report.bigMoves.slice(0, 5).map((m) => `${m.key} ${m.date} ${pct(m.pct)}`).join(", ")})` : ""}; ` +
      `score stored on ${report.scoreCoverage === null ? "n/a" : `${(report.scoreCoverage * 100).toFixed(0)}%`} of rows`,
    "",
    row("", "Strategy", "Nifty 50"),
    row("CAGR", pct(s.cagr), pct(b.cagr)),
    row("Total return", pct(s.totalReturn), pct(b.totalReturn)),
    row("Max drawdown", pct(s.maxDrawdown), pct(b.maxDrawdown)),
    row("Volatility", plain(s.volatility), plain(b.volatility)),
    row("Sharpe (rf 0)", num(s.sharpe), num(b.sharpe)),
    row("Trades", String(s.trades), "-"),
    row("Hit rate", plain(s.hitRate), "-"),
    row("Avg win / loss", `${pct(s.avgWinPct)} / ${pct(s.avgLossPct)}`, "-"),
    row("Turnover per year", num(s.turnoverPerYear), "-"),
    row("Time invested", plain(s.timeInvested), "-"),
    "",
    ...caveats(run.strategy.id).map((c) => `- ${c}`),
  ];
  return lines.join("\n");
}
