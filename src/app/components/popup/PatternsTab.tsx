import { fmtDate } from "@/lib/view/dashboard";
import type { PopupData } from "@/lib/view/popup";
import { Chip, type Tone } from "../ui";

const BIAS: Record<string, Tone> = { bullish: "up", bearish: "down", neutral: "neutral" };

/** "bullish_engulfing" / "morningStar" → "Bullish Engulfing" / "Morning Star". */
export const titleCase = (s: string) =>
  s
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());

const fmtEffect = (n: number) => (n === 0 ? "0" : `${n > 0 ? "+" : "−"}${Math.abs(n).toFixed(2)}`);

export function PatternsTab({ patterns }: { patterns: PopupData["patterns"] }) {
  if (patterns.length === 0) {
    return <p className="py-6 text-center text-sm text-[var(--muted)]">No candlestick patterns in the last 10 sessions</p>;
  }
  return (
    <div className="relative overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="font-mono text-[10px] uppercase tracking-wider text-[var(--muted)]">
          <tr>
            <th className="py-1 text-left font-medium">Date</th>
            <th className="px-2 text-left font-medium">Pattern</th>
            <th className="px-2 text-left font-medium">Bias</th>
            <th className="px-2 text-right font-medium">Effect (pts)</th>
          </tr>
        </thead>
        <tbody>
          {patterns.map((p, i) => (
            <tr key={`${p.date}-${p.name}-${i}`} className="border-t border-[var(--border)] hover:bg-slate-800/40">
              <td className="whitespace-nowrap py-1.5 font-mono tabular-nums text-[var(--muted)]">{fmtDate(p.date)}</td>
              <td className="whitespace-nowrap px-2 font-medium">{titleCase(p.name)}</td>
              <td className="px-2">
                <Chip tone={BIAS[p.bias] ?? "neutral"}>{titleCase(p.bias)}</Chip>
              </td>
              <td
                className={`px-2 text-right font-mono tabular-nums ${p.effect > 0 ? "text-[var(--up)]" : p.effect < 0 ? "text-[var(--down)]" : "text-[var(--muted)]"}`}
              >
                {fmtEffect(p.effect)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
