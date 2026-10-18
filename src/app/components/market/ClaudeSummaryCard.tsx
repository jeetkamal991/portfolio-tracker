import type { ReactNode } from "react";
import type { MarketEvent, ParsedSummary } from "@/lib/content/claude";
import { fmtDate } from "@/lib/view/dashboard";
import { StockLink } from "../popup/StockLink";
import { Chip, Label, Panel } from "../ui";

function SourceLink({ url }: { url: string | null }) {
  if (!url) return null;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="font-mono text-xs text-[var(--up)] hover:underline">
      source ↗
    </a>
  );
}

function Item({ title, explanation, sourceUrl, lead }: MarketEvent & { lead?: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex flex-wrap items-baseline gap-x-2">
        {lead}
        <span className="text-sm font-semibold">{title}</span>
      </div>
      <p className="max-w-[65ch] text-sm leading-relaxed text-[var(--muted)]">{explanation}</p>
      <SourceLink url={sourceUrl} />
    </div>
  );
}

export function ClaudeSummaryCard({ summary, session }: { summary: ParsedSummary | null; session: string | null }) {
  const date = summary?.date ?? session;
  return (
    <Panel
      title="TODAY BY CLAUDE"
      action={
        <span className="flex items-center gap-2">
          {date && <Label>{fmtDate(date)}</Label>}
          <Chip tone="neutral">Claude</Chip>
        </span>
      }
    >
      {!summary ? (
        <p className="text-sm text-[var(--muted)]">No summary for today. Claude writes it on trading days around 6 PM IST.</p>
      ) : (
        <div className="flex flex-col gap-5" aria-label="Claude's daily summary">
          {summary.summary && <p className="max-w-[65ch] whitespace-pre-line text-sm leading-relaxed">{summary.summary}</p>}
          {summary.events.length > 0 && (
            <div className="flex flex-col gap-2">
              <Label>TOP 3 HAPPENINGS</Label>
              <ol className="flex flex-col gap-3">
                {summary.events.map((e, i) => (
                  <li key={i} className="flex gap-3">
                    <span className="font-mono text-sm tabular-nums text-[var(--muted)]">{i + 1}.</span>
                    <Item {...e} />
                  </li>
                ))}
              </ol>
            </div>
          )}
          {summary.news.length > 0 && (
            <div className="flex flex-col gap-2">
              <Label>YOUR STOCKS</Label>
              <ul className="flex flex-col gap-3">
                {summary.news.map((n, i) => (
                  <li key={`${n.key}-${i}`}>
                    <Item
                      {...n}
                      lead={
                        <StockLink stockKey={n.key} className="font-mono text-xs font-semibold text-[var(--up)]">
                          {n.key}
                        </StockLink>
                      }
                    />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}
