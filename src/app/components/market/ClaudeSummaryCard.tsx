import type { MarketEvent, ParsedSummary, WatchNews } from "@/lib/content/claude";
import { fmtDate } from "@/lib/view/dashboard";
import { fmtShortDate } from "@/lib/view/market";
import { StockLink } from "../popup/StockLink";
import { ClampText } from "./ClampText";
import { SummaryBullets } from "./SummaryBullets";
import { Chip, Label, Panel } from "../ui";

function SourceChip({ url }: { url: string | null }) {
  if (!url) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center whitespace-nowrap rounded-md border border-[var(--border)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--up)] hover:border-[var(--up)]"
    >
      source ↗
    </a>
  );
}

function EventTile({ n, e }: { n: number; e: MarketEvent }) {
  return (
    <li className="flex gap-3 rounded-lg border border-[var(--border)] bg-[var(--panel-2)] p-3">
      <span
        aria-hidden
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[color-mix(in_srgb,var(--accent)_15%,transparent)] font-mono text-xs font-semibold text-[var(--accent)]"
      >
        {n}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="text-sm font-semibold">{e.title}</span>
        <ClampText text={e.explanation} className="text-sm leading-relaxed text-[var(--muted)]" />
        {e.sourceUrl && (
          <div>
            <SourceChip url={e.sourceUrl} />
          </div>
        )}
      </div>
    </li>
  );
}

function NewsRow({ n }: { n: WatchNews }) {
  const upcoming = n.kind === "upcoming";
  return (
    <li className="flex flex-col gap-1 border-b border-[var(--border)] pb-2.5 last:border-b-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-2">
        <StockLink stockKey={n.key} className="font-mono text-xs font-semibold text-[var(--up)]">
          {n.key}
        </StockLink>
        <Chip tone={upcoming ? "warn" : "neutral"}>
          {upcoming ? `Upcoming${n.date ? ` · ${fmtShortDate(n.date)}` : ""}` : "Today"}
        </Chip>
        <span className="ml-auto">
          <SourceChip url={n.sourceUrl} />
        </span>
      </div>
      <ClampText text={n.note} limit={120} className="text-sm leading-relaxed" />
    </li>
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
          {summary.summary && (
            <div className="max-w-[75ch] border-l-2 border-[var(--accent)] pl-4">
              <SummaryBullets text={summary.summary} max={8} />
            </div>
          )}
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
            <div className="flex min-w-0 flex-col gap-2 lg:col-span-3">
              <Label>TOP 3 HAPPENINGS</Label>
              {summary.events.length === 0 ? (
                <p className="text-sm text-[var(--muted)]">No market events listed today.</p>
              ) : (
                <ol className="flex flex-col gap-2">
                  {summary.events.map((e, i) => (
                    <EventTile key={i} n={i + 1} e={e} />
                  ))}
                </ol>
              )}
            </div>
            <div className="flex min-w-0 flex-col gap-2 lg:col-span-2">
              <Label>FOR YOUR STOCKS</Label>
              {summary.news.length === 0 ? (
                <p className="text-sm text-[var(--muted)]">Nothing to flag for your stocks today.</p>
              ) : (
                <ul className="flex flex-col gap-2.5 rounded-lg border border-[var(--border)] bg-[var(--panel-2)] p-3">
                  {summary.news.map((n, i) => (
                    <NewsRow key={`${n.key}-${i}`} n={n} />
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </Panel>
  );
}
