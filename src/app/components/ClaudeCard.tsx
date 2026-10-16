import type { DailySummary } from "@/lib/db/types";

// Rich content (events, news) is rendered by the Claude-tasks plan; for now show the text.
export function ClaudeCard({ summary }: { summary: DailySummary | null }) {
  return (
    <section aria-label="Claude's daily summary" className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
      <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-neutral-500">Today by Claude</h2>
      {summary ? (
        <p className="whitespace-pre-line text-sm">{summary.summary}</p>
      ) : (
        <p className="text-sm text-neutral-500">No summary for today</p>
      )}
    </section>
  );
}
