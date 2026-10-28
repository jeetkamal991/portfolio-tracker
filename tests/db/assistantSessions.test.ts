import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createMemoryRepo } from "@/lib/db/memoryRepo";
import { createSupabaseRepo } from "@/lib/db/supabaseRepo";
import type { AssistantMessage } from "@/lib/db/types";

const user: AssistantMessage = { role: "user", text: "hello" };
const reply: AssistantMessage = { role: "assistant", steps: [], text: "hi", usage: null, reports: [] };

describe("assistant sessions (memory repo)", () => {
  it("round-trips a session", async () => {
    const repo = createMemoryRepo();
    const id = await repo.createAssistantSession("hello");
    const s = await repo.getAssistantSession(id);
    expect(s).toMatchObject({ id, title: "hello", cliSessionId: null, messages: [] });
  });

  it("update changes messages, cli id and updatedAt", async () => {
    const repo = createMemoryRepo();
    const id = await repo.createAssistantSession("t");
    const before = (await repo.getAssistantSession(id))!;
    await new Promise((r) => setTimeout(r, 5));
    await repo.updateAssistantSession(id, { cliSessionId: "c1", messages: [user, reply] });
    const after = (await repo.getAssistantSession(id))!;
    expect(after.cliSessionId).toBe("c1");
    expect(after.messages).toEqual([user, reply]);
    expect(after.updatedAt > before.updatedAt).toBe(true);
  });

  it("lists newest-updated first without messages", async () => {
    const repo = createMemoryRepo();
    const a = await repo.createAssistantSession("a");
    const b = await repo.createAssistantSession("b");
    await new Promise((r) => setTimeout(r, 5));
    await repo.updateAssistantSession(a, { messages: [user] });
    const list = await repo.listAssistantSessions();
    expect(list.map((s) => s.id)).toEqual([a, b]);
    expect(list[0]).not.toHaveProperty("messages");
  });

  it("deletes; unknown id is null", async () => {
    const repo = createMemoryRepo();
    const id = await repo.createAssistantSession("t");
    await repo.deleteAssistantSession(id);
    expect(await repo.getAssistantSession(id)).toBeNull();
    expect(await repo.getAssistantSession(999)).toBeNull();
  });
});

describe("assistant sessions (supabase repo)", () => {
  it("maps columns on create and get", async () => {
    let inserted: Record<string, unknown> = {};
    const row = { id: 5, created_at: "c", updated_at: "u", title: "t", cli_session_id: "cli", messages: [user] };
    const db = {
      from: (table: string) => {
        expect(table).toBe("assistant_sessions");
        const q: Record<string, unknown> = {};
        q.insert = (v: Record<string, unknown>) => { inserted = v; return q; };
        q.select = () => q; q.eq = () => q;
        q.single = () => Promise.resolve({ data: { id: 5 }, error: null });
        q.maybeSingle = () => Promise.resolve({ data: row, error: null });
        return q;
      },
    } as unknown as SupabaseClient;
    const repo = createSupabaseRepo(db);
    expect(await repo.createAssistantSession("t")).toBe(5);
    expect(inserted).toEqual({ title: "t", messages: [] });
    expect(await repo.getAssistantSession(5)).toEqual({ id: 5, createdAt: "c", updatedAt: "u", title: "t", cliSessionId: "cli", messages: [user] });
  });
});
