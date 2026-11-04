import Link from "next/link";
import type { ParsedSummary } from "@/lib/content/claude";
import { fmtDate } from "@/lib/view/dashboard";
import { SummaryBullets } from "../market/SummaryBullets";
import { StockLink } from "../popup/StockLink";
import { Chip, Label, Panel } from "../ui";

const NEWS_SHOWN = 3;
const EVENTS_SHOWN = 3;

/** The Dashboard's short version: highlights as points, a few news lines, and a link to the full write-up. */
export function TodayByClaudeCompact({ summary, session }: { summary: ParsedSummary | null; session: string | null }) {
  const date = summary?.date ?? session;
  return (
    <Panel
      title="TODAY BY CLAUDE"
      action={
        <span className="flex items-center gap-2">
          {date && <Label>{fmtDate(date)}</Label>}
          <Link href="/market" className="font-mono text-xs text-[var(--up)] hover:underline">
            Full details →
          </Link>
        </span>
      }
    >
      {!summary ? (
        <p className="text-sm text-[var(--muted)]">No summary for today. Claude writes it on trading days around 6 PM IST.</p>
      ) : (
        <div className="flex flex-col gap-4" aria-label="Claude's daily highlights">
          <div className="flex flex-col gap-2">
            <Label>HIGHLIGHTS</Label>
            {summary.summary ? <SummaryBullets text={summary.summary} max={4} /> : <p className="text-sm text-[var(--muted)]">No highlights written.</p>}
          </div>

          <div className="flex flex-col gap-2 border-t border-[var(--border)] pt-3">
            <Label>NEWS</Label>
            {summary.events.length === 0 && summary.news.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">No verified news for today. The Market tab lists sources when there are any.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {summary.events.slice(0, EVENTS_SHOWN).map((e, i) => (
                  <li key={`e${i}`} className="flex items-start gap-2 text-sm">
                    <Chip tone="neutral">Market</Chip>
                    <span className="min-w-0 flex-1 font-semibold">{e.title}</span>
                  </li>
                ))}
                {summary.news.slice(0, NEWS_SHOWN).map((n, i) => (
                  <li key={`n${i}`} className="flex items-start gap-2 text-sm">
                    <StockLink stockKey={n.key} className="font-mono text-xs font-semibold text-[var(--up)]">
                      {n.key}
                    </StockLink>
                    <span className="min-w-0 flex-1 text-[var(--muted)]">{n.note}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </Panel>
  );
}
