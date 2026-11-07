import Link from "next/link";
import type { PortfolioSide } from "@/lib/api/portfolioSide";
import { fmtPct, pctTone } from "@/lib/view/dashboard";
import { fmtInr, fmtSignedInr, type LadderRow, type PortfolioRow, type Totals } from "@/lib/view/portfolio";
import { StockLink } from "../popup/StockLink";
import { Chip, Label, Panel } from "../ui";

const TONE = { up: "text-[var(--up)]", down: "text-[var(--down)]", warn: "text-[var(--warn)]", muted: "text-[var(--muted)]" } as const;

function Money({ label, value, sub, tone = "" }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div>
      <Label>{label}</Label>
      <div className={`font-mono text-lg font-semibold tabular-nums ${tone}`}>{value}</div>
      {sub && <div className={`font-mono text-xs tabular-nums ${tone}`}>{sub}</div>}
    </div>
  );
}

export function PortfolioHero({
  totals,
  live,
  ladder,
  rows,
  side,
}: {
  totals: Totals;
  live: boolean;
  ladder: LadderRow[];
  rows: PortfolioRow[];
  side: PortfolioSide;
}) {
  const priced = totals.count - totals.unpriced > 0;
  const count = (s: PortfolioRow["status"]) => rows.filter((r) => r.status === s).length;
  const atStop = count("SL_HIT");
  const nearStop = count("NEAR_SL");
  const atTarget = count("TARGET_HIT");
  const pnlTone = priced ? pctTone(totals.pnl) : "text-[var(--muted)]";
  const todayTone = priced ? pctTone(totals.todayPnl) : "text-[var(--muted)]";

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.3fr_1fr]">
      <div className="flex min-w-0 flex-col gap-5 rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <Label>Portfolio value {live && <Chip tone="up">LIVE</Chip>}</Label>
            <div className="font-mono text-4xl font-semibold leading-tight tracking-tighter tabular-nums sm:text-5xl">{priced ? fmtInr(totals.value, 0) : "—"}</div>
            <div className={`font-mono text-sm tabular-nums ${todayTone}`}>{priced ? `${fmtSignedInr(totals.todayPnl, 0)} today` : "No prices yet"}</div>
          </div>
          <div className="flex flex-wrap gap-2">
            {atStop > 0 && <Chip tone="down">{atStop} at stop</Chip>}
            {nearStop > 0 && <Chip tone="warn">{nearStop} near stop</Chip>}
            {atTarget > 0 && <Chip tone="up">{atTarget} at target</Chip>}
            {atStop + nearStop + atTarget === 0 && totals.count > 0 && <Chip tone="neutral">No risk flags</Chip>}
          </div>
        </div>
        <div className="flex flex-wrap gap-x-8 gap-y-3">
          <Money label="Overall P/L" value={priced ? fmtSignedInr(totals.pnl, 0) : "—"} sub={priced ? fmtPct(totals.pnlPct) : undefined} tone={pnlTone} />
          <Money label="Invested" value={priced ? fmtInr(totals.invested, 0) : "—"} />
          <Money label="Holdings" value={String(totals.count)} sub={totals.unpriced > 0 ? `${totals.unpriced} without price` : undefined} />
        </div>

        <div className="flex flex-col gap-3">
          <Label>Where each holding sits between its stop and its target</Label>
          {ladder.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">Add a holding to see its risk ladder.</p>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {ladder.map((l) => (
                <li key={l.key} className="grid grid-cols-[88px_1fr_auto] items-center gap-3 text-sm sm:grid-cols-[110px_1fr_130px]">
                  <StockLink stockKey={l.key} className="truncate font-semibold">{l.key}</StockLink>
                  {l.pos === null ? (
                    <Link href={`/portfolio?edit=${encodeURIComponent(l.key)}`} className="text-xs text-[var(--muted)] hover:text-[var(--up)]">
                      {l.label === "no price" ? "Waiting for a price" : "Set a stop loss and Target 1 to see the ladder"}
                    </Link>
                  ) : (
                    <div className="relative h-2.5 rounded-md" style={{ background: "linear-gradient(90deg, rgba(251,113,133,.30), rgba(251,191,36,.20) 40%, rgba(52,211,153,.30))" }} role="img" aria-label={`${l.key}: ${l.label}`}>
                      <i className="absolute -top-1 h-[18px] w-1 -translate-x-1/2 rounded-sm bg-[var(--text)] shadow-[0_0_0_2px_var(--bg)]" style={{ left: `${(l.pos * 100).toFixed(1)}%` }} />
                    </div>
                  )}
                  <span className={`text-right font-mono text-xs tabular-nums ${TONE[l.tone]}`}>{l.pos === null ? "" : l.label}</span>
                </li>
              ))}
            </ul>
          )}
          {ladder.some((l) => l.pos !== null) && <p className="text-xs text-[var(--muted)]">Left edge is your stop loss, right edge is Target 1.</p>}
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-4">
        <Panel title="Market, quietly">
          {side.nifty ? (
            <div className="font-mono text-2xl font-semibold tabular-nums">
              {side.nifty.close === null ? "—" : side.nifty.close.toLocaleString("en-IN", { maximumFractionDigits: 0 })}{" "}
              <span className={`text-sm ${pctTone(side.nifty.dayPct)}`}>{fmtPct(side.nifty.dayPct)}</span>
              <div className="font-sans text-xs font-normal text-[var(--muted)]">Nifty 50</div>
            </div>
          ) : (
            <p className="text-sm text-[var(--muted)]">No Nifty data yet.</p>
          )}
        </Panel>
        <Panel title="Sectors">
          {side.sectors.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">No sector data yet.</p>
          ) : (
            <p className="text-sm">
              {[...side.sectors.slice(0, 2), ...side.sectors.slice(-1)]
                .filter((s, i, a) => s.d1 !== null && a.findIndex((x) => x.name === s.name) === i)
                .map((s, i) => (
                  <span key={s.name}>
                    {i > 0 && <span className="text-[var(--muted)]"> · </span>}
                    <span className={pctTone(s.d1)}>
                      {s.name} {fmtPct(s.d1)}
                    </span>
                  </span>
                ))}
            </p>
          )}
        </Panel>
      </div>
    </div>
  );
}
