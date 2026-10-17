import type { DailySummary } from "@/lib/db/types";
import { Panel } from "./ui";

// Rich content (events, news) is rendered by the Claude-tasks plan; for now show the text.
export function ClaudeCard({ summary }: { summary: DailySummary | null }) {
  return (
    <Panel title="Today by Claude">
      <div aria-label="Claude's daily summary">
        {summary ? (
          <p className="whitespace-pre-line text-sm">{summary.summary}</p>
        ) : (
          <p className="text-sm text-[var(--muted)]">No summary for today</p>
        )}
      </div>
    </Panel>
  );
}
