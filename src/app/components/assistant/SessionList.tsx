"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { AssistantSessionSummary } from "@/lib/db/types";

export function SessionList({ sessions, activeId, canRun }: { sessions: AssistantSessionSummary[]; activeId: number | null; canRun: boolean }) {
  const router = useRouter();
  async function remove(id: number) {
    if (!window.confirm("Delete this chat?")) return;
    await fetch(`/api/assistant/sessions/${id}`, { method: "DELETE" });
    if (id === activeId) router.push("/assistant");
    else router.refresh();
  }
  return (
    <nav aria-label="Chats" className="flex flex-col gap-1">
      {canRun && (
        <Link href="/assistant" className="mb-1 rounded-md border border-[var(--border)] px-3 py-2 text-center text-sm font-semibold hover:border-[var(--up)]">
          New chat
        </Link>
      )}
      {sessions.length === 0 && <p className="px-1 text-xs text-[var(--muted)]">No chats yet.</p>}
      {sessions.map((s) => (
        <div key={s.id} className={`group flex items-center gap-1 rounded-md ${s.id === activeId ? "bg-slate-800" : ""}`}>
          <Link
            href={`/assistant?s=${s.id}`}
            aria-current={s.id === activeId ? "page" : undefined}
            className={`min-w-0 flex-1 truncate px-3 py-2 text-sm hover:text-[var(--up)] ${s.id === activeId ? "text-[var(--up)]" : ""}`}
          >
            {s.title}
          </Link>
          {canRun && (
            <button type="button" aria-label={`Delete chat ${s.title}`} onClick={() => remove(s.id)} className="px-2 py-1 text-xs text-[var(--muted)] hover:text-[var(--down)]">
              ✕
            </button>
          )}
        </div>
      ))}
    </nav>
  );
}
