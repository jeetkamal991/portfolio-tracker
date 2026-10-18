import type { Breadth } from "@/lib/view/breadth";
import { fmtPrice } from "@/lib/view/dashboard";
import { BreadthBar } from "../BreadthBar";
import { Sparkline } from "../Sparkline";
import { Label, Panel, PctText } from "../ui";

export function BreadthPanel({ breadth, hasUniverse }: { breadth: Breadth | null; hasUniverse: boolean }) {
  if (!breadth) {
    return (
      <Panel title="BREADTH">
        <p className="text-sm text-[var(--muted)]">No session data yet.</p>
      </Panel>
    );
  }
  const pct = breadth.aboveEma200;
  return (
    <Panel title="BREADTH">
      <div className="flex flex-col gap-6">
        {hasUniverse ? (
          <>
            <BreadthBar breadth={breadth} />
            <div className="flex flex-col gap-2">
              <Label>% ABOVE EMA 200</Label>
              <span className="font-mono text-3xl font-extrabold tabular-nums">{pct === null ? "—" : `${(pct * 100).toFixed(0)}%`}</span>
              <div className="h-1.5 rounded-full bg-[var(--panel-2)]">
                <div className="h-1.5 rounded-full" style={{ width: `${pct === null ? 0 : pct * 100}%`, background: "var(--up)" }} />
              </div>
              <span className="font-mono text-xs tabular-nums text-[var(--muted)]">
                {breadth.aboveEma200Count} / {breadth.ema200Count}
              </span>
            </div>
          </>
        ) : (
          <p className="text-sm text-[var(--muted)]">Breadth appears after the Nifty 200 list is imported.</p>
        )}
        {breadth.vix.close !== null && (
          <div className="flex flex-col gap-2">
            <Label>INDIA VIX</Label>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <span className="font-mono text-xl font-bold tabular-nums">{fmtPrice(breadth.vix.close)}</span>
              <PctText value={breadth.vix.dayPct} className="text-sm" />
              <Sparkline values={breadth.vix.spark} label="India VIX, last 21 sessions" />
            </div>
          </div>
        )}
      </div>
    </Panel>
  );
}
