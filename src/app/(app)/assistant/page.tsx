import { getRepo } from "@/lib/api/server";
import type { AssistantSession, AssistantSessionSummary } from "@/lib/db/types";
import { parseRunId } from "@/lib/view/backtests";
import { Chat } from "../../components/assistant/Chat";
import { SessionList } from "../../components/assistant/SessionList";
import { Panel } from "../../components/ui";

export const dynamic = "force-dynamic";

export default async function AssistantPage({ searchParams }: { searchParams: Promise<{ s?: string }> }) {
  const { s } = await searchParams;
  const canRun = !process.env.VERCEL;
  let sessions: AssistantSessionSummary[];
  let current: AssistantSession | null = null;
  try {
    const repo = getRepo();
    const id = s ? parseRunId(s) : null;
    [sessions, current] = await Promise.all([repo.listAssistantSessions(), id ? repo.getAssistantSession(id) : Promise.resolve(null)]);
  } catch (e) {
    console.error("assistant sessions failed", e);
    return (
      <Panel title="RESEARCH ASSISTANT">
        <p className="text-sm text-[var(--warn)]">
          Couldn&apos;t read the chats. Apply <code className="font-mono">supabase/migrations/0011_assistant_sessions.sql</code>, then reload.
        </p>
      </Panel>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[260px_1fr]">
      <aside className="min-w-0">
        <details className="lg:hidden" open={false}>
          <summary className="cursor-pointer rounded-md border border-[var(--border)] px-3 py-2 text-sm font-semibold">Chats ({sessions.length})</summary>
          <div className="mt-2">
            <SessionList sessions={sessions} activeId={current?.id ?? null} canRun={canRun} />
          </div>
        </details>
        <div className="hidden lg:block">
          <SessionList sessions={sessions} activeId={current?.id ?? null} canRun={canRun} />
        </div>
      </aside>
      <div className="min-w-0">
        <Chat key={current?.id ?? "new"} initialId={current?.id ?? null} initialMessages={current?.messages ?? []} canRun={canRun} />
      </div>
    </div>
  );
}
