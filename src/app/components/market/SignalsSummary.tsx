import type { WatchSignals } from "@/lib/calc/watchSignals";
import { fmtShortDate } from "@/lib/view/market";
import { StockLink } from "../popup/StockLink";
import { Chip, Panel, type Tone } from "../ui";
import { ViewLink } from "./MarketBoard";

const BIAS: Record<string, Tone> = { bullish: "up", bearish: "down", neutral: "neutral" };
const SHOWN = 4;

/** The Market tab's top-row card: how many signals your stocks have, and the first few. The full lists are the Your stocks view. */
export function SignalsSummary({ signals, hasWatchStocks }: { signals: WatchSignals; hasWatchStocks: boolean }) {
  const all = [...signals.crosses, ...signals.formations];
  return (
    <Panel title="YOUR STOCKS · SIGNALS" action={<span className="text-xs text-[var(--muted)]">last 5 sessions</span>}>
      {!hasWatchStocks ? (
        <p className="text-sm text-[var(--muted)]">Add stocks to your watchlist to see signals here.</p>
      ) : all.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">No crosses or candle patterns on your stocks in the last 5 sessions.</p>
      ) : (
        <div className="flex flex-col gap-3">
          <ul className="flex flex-col gap-2">
            {all.slice(0, SHOWN).map((s, i) => (
              <li key={`${s.key}-${s.label}-${i}`} className="flex items-center gap-2 text-sm">
                <StockLink stockKey={s.key} className="min-w-0 flex-1 truncate font-semibold">
                  {s.key}
                </StockLink>
                <span className="min-w-0 flex-[2] truncate text-xs text-[var(--muted)]">{s.label}</span>
                <Chip tone={BIAS[s.bias] ?? "neutral"}>{fmtShortDate(s.date)}</Chip>
              </li>
            ))}
          </ul>
          <ViewLink view="you" className="self-start">
            {all.length > SHOWN ? `See all ${all.length} →` : "Open Your stocks →"}
          </ViewLink>
        </div>
      )}
    </Panel>
  );
}
