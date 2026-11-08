import Link from "next/link";
import { cached, getRepo } from "@/lib/api/server";
import { SCORING_VERSION } from "@/lib/calc/scoreV2/config";
import { filterSnapshots, metricsOf, rankSnapshots, type RankFilters, type RankKind } from "@/lib/view/snapshotRank";
import { StockLink } from "../../components/popup/StockLink";
import { Label, Panel } from "../../components/ui";

export const dynamic = "force-dynamic";

const KINDS: { id: RankKind; label: string; help: string }[] = [
  { id: "technical", label: "Technical strength", help: "Highest technical score. Breakout stocks stay in this list." },
  { id: "tradeQuality", label: "Trade quality", help: "Needs 80% coverage or more and a valid reward-to-risk. No target is ever invented, so breakout stocks without one are excluded here." },
  { id: "combined", label: "Technical + trade", help: "Mean of both scores, only for stocks eligible in both rankings." },
  { id: "relativeStrength", label: "Relative strength", help: "Share of the relative-strength points earned, for stocks eligible in the technical ranking." },
  { id: "volume", label: "Volume confirmation", help: "Share of the volume points earned, for stocks eligible in the technical ranking." },
];
const INPUT = "w-full rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-2 py-1.5 font-mono text-xs text-[var(--text)] focus:border-[var(--up)] focus:outline-none";
const NUMERIC_FILTERS = [
  ["minTechnical", "Min technical"], ["minTrade", "Min trade quality"], ["minConfidence", "Min confidence %"], ["rsiMin", "RSI from"],
  ["rsiMax", "RSI to"], ["minRvol", "Min rel. volume"], ["minTradedCr", "Min traded ₹ cr/day"],
] as const;

const PRESETS = [
  ["Technical 75+ and Trade 65+", "kind=combined&minTechnical=75&minTrade=65"],
  ["Technical 75+, above all EMAs", "kind=technical&minTechnical=75&trend=above_all"],
] as const;

type SP =Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const numParam = (v: string | string[] | undefined) => {
  const s = one(v);
  if (s === undefined || s.trim() === "") return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
};

export default async function RankingsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const kind = KINDS.find((k) => k.id === one(sp.kind))?.id ?? "technical";
  const trend = one(sp.trend);
  const filters: RankFilters = {
    minTechnical: numParam(sp.minTechnical), minTrade: numParam(sp.minTrade), minConfidence: numParam(sp.minConfidence),
    sector: one(sp.sector) || undefined, rsiMin: numParam(sp.rsiMin), rsiMax: numParam(sp.rsiMax), minRvol: numParam(sp.minRvol), minTradedCr: numParam(sp.minTradedCr),
    trend: trend === "above_all" || trend === "mixed" || trend === "below_all" ? trend : undefined,
  };
  const repo = getRepo();
  // Snapshots are written once a day after the close and are not user-specific, so a short per-instance memo is safe; the date
  // lookup is memoised for the same minute, which makes a repeat visit (or a filter change) cost one read, not two.
  const date = await cached(`snapshot-date:${SCORING_VERSION}`, () => repo.latestSnapshotDate(SCORING_VERSION), 60_000);
  if (!date) {
    return (
      <Panel title="RANKINGS">
        <p className="text-sm text-[var(--muted)]">No {SCORING_VERSION} snapshots exist yet. They are generated after market close.</p>
      </Panel>
    );
  }
  const all = await cached(`snapshot-summaries:${SCORING_VERSION}:${date}`, () => repo.listSnapshotSummaries({ version: SCORING_VERSION, date }), 60_000);
  const sectors = [...new Set(all.map((r) => metricsOf(r).sector).filter((s): s is string => !!s))].sort();
  const rows = filterSnapshots(all, filters);
  const ranking = rankSnapshots(rows, { version: SCORING_VERSION, kind });
  const byKey = new Map(rows.map((r) => [r.symbol, r]));
  const active = Object.entries(sp).filter(([k, v]) => k !== "kind" && typeof v === "string" && v !== "") as [string, string][];
  const qs = (k: string) => new URLSearchParams([["kind", k], ...active]).toString();
  const help = KINDS.find((k) => k.id === kind)!.help;

  return (
    <div className="flex flex-col gap-4">
      <Panel title={`RANKINGS · ${SCORING_VERSION} · ${date}`}>
        <nav aria-label="Ranking type" className="mb-3 flex flex-wrap gap-1">
          {KINDS.map((k) => (
            <Link
              key={k.id}
              href={`/rankings?${qs(k.id)}`}
              aria-current={k.id === kind ? "page" : undefined}
              className={`rounded-lg border px-3 py-1.5 text-sm ${k.id === kind ? "border-[var(--border)] bg-slate-800 text-[var(--up)]" : "border-transparent text-[var(--muted)] hover:text-[var(--text)]"}`}
            >
              {k.label}
            </Link>
          ))}
        </nav>
        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
          <Label>Watch-list presets</Label>
          {PRESETS.map(([label, query]) => (
            <Link key={label} href={`/rankings?${query}`} className="rounded-lg border border-[var(--border)] px-2 py-1 text-[var(--muted)] hover:text-[var(--text)]">{label}</Link>
          ))}
          <span className="text-[11px] text-[var(--muted)]">A shortlist to study, not a buy or sell signal.</span>
        </div>
        <p className="mb-3 text-xs text-[var(--muted)]">{help} Only {SCORING_VERSION} scores are ranked here; legacy_v1 is never mixed in.</p>
        <form method="get" className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
          <input type="hidden" name="kind" value={kind} />
          {NUMERIC_FILTERS.map(([name, label]) => (
            <label key={name} className="flex flex-col gap-1">
              <Label>{label}</Label>
              <input name={name} defaultValue={one(sp[name]) ?? ""} inputMode="decimal" className={INPUT} />
            </label>
          ))}
          <label className="flex flex-col gap-1">
            <Label>Sector</Label>
            <select name="sector" defaultValue={filters.sector ?? ""} className={INPUT}>
              <option value="">All</option>
              {sectors.map((s) => <option key={s} value={s}>{s.replace("NIFTY_", "")}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <Label>Trend vs EMA 20/50/200</Label>
            <select name="trend" defaultValue={filters.trend ?? ""} className={INPUT}>
              <option value="">Any</option>
              <option value="above_all">Above all</option>
              <option value="mixed">Mixed</option>
              <option value="below_all">Below all</option>
            </select>
          </label>
          <div className="flex items-end gap-2">
            <button type="submit" className="rounded-lg border border-[var(--up)] px-3 py-1.5 text-xs font-semibold text-[var(--up)]">Apply</button>
            <Link href={`/rankings?kind=${kind}`} className="px-2 py-1.5 text-xs text-[var(--muted)] hover:text-[var(--text)]">Reset</Link>
          </div>
        </form>
        <p className="mt-2 text-[11px] text-[var(--muted)]">
          There is no market-cap filter yet: market cap is collected but not used by any ranking. A stock whose value for a filter is unknown does not pass that filter.
        </p>
      </Panel>

      <Panel title={`${ranking.ranked.length} RANKED · ${ranking.excluded.length} NOT RANKED · ${all.length} EVALUATED`}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="font-mono text-[10px] uppercase tracking-wider text-[var(--muted)]">
              <tr className="text-right">
                <th className="px-2 py-2 text-left">#</th><th className="px-2 text-left">Stock</th><th className="px-2">Score</th><th className="px-2">Tech</th>
                <th className="px-2">Trade</th><th className="px-2">Coverage</th><th className="px-2">Conf.</th><th className="px-2">RSI</th><th className="px-2">RVOL</th>
                <th className="px-2 text-left">Entry observation</th>
              </tr>
            </thead>
            <tbody>
              {ranking.ranked.map((r, i) => {
                const s = byKey.get(r.symbol)!;
                const m = metricsOf(s);
                const obs = ((s.dataCoverage ?? {}) as { tradeQuality?: { observation?: string } }).tradeQuality?.observation ?? "—";
                return (
                  <tr key={r.symbol} className="border-t border-[var(--border)] text-right font-mono tabular-nums hover:bg-slate-800/40">
                    <td className="px-2 py-1.5 text-left text-[var(--muted)]">{i + 1}</td>
                    <td className="px-2 text-left font-sans"><StockLink stockKey={r.symbol}>{r.symbol}</StockLink></td>
                    <td className="px-2 font-semibold">{r.score.toFixed(0)}</td>
                    <td className="px-2">{s.technicalScore?.toFixed(0) ?? "—"}</td>
                    <td className="px-2">{s.tradeQualityScore?.toFixed(0) ?? "—"}</td>
                    <td className="px-2">{(r.coverage * 100).toFixed(0)}%</td>
                    <td className="px-2">{r.dataConfidence?.toFixed(0) ?? "—"}</td>
                    <td className="px-2">{m.rsi?.toFixed(0) ?? "—"}</td>
                    <td className="px-2">{m.rvol?.toFixed(1) ?? "—"}</td>
                    <td className="px-2 text-left font-sans text-xs text-[var(--muted)]">{obs}</td>
                  </tr>
                );
              })}
              {ranking.ranked.length === 0 && (
                <tr><td colSpan={10} className="py-6 text-center text-sm text-[var(--muted)]">No stock matches these filters.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {ranking.excluded.length > 0 && (
          <details className="mt-4 text-xs text-[var(--muted)]">
            <summary className="cursor-pointer">{ranking.excluded.length} stock(s) not ranked, with the reason (never ranked as if fully verified)</summary>
            <ul className="mt-2 grid gap-x-6 sm:grid-cols-2">
              {ranking.excluded.map((e) => <li key={e.symbol}><span className="font-mono text-[var(--text)]">{e.symbol}</span>: {e.reason}</li>)}
            </ul>
          </details>
        )}
      </Panel>
    </div>
  );
}
