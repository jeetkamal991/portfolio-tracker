"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { AssistantEvent } from "@/lib/assistant/stream";
import type { AssistantMessage } from "@/lib/db/types";
import { applyEvent, emptyTurn, fmtCost, splitSse, STARTERS, type AssistantTurn } from "@/lib/view/assistant";
import { Answer } from "./Answer";
import { Composer, MODELS } from "./Composer";
import { ReportCard } from "./ReportCard";
import { Steps } from "./Steps";

const MODEL_KEY = "assistant-model";

function Turn({ turn, running }: { turn: AssistantTurn; running: boolean }) {
  return (
    <div className="max-w-3xl">
      <Steps steps={turn.steps} running={running} />
      {turn.text ? <Answer text={turn.text} /> : running && turn.steps.length === 0 && <p className="animate-pulse text-sm text-[var(--muted)]">Thinking…</p>}
      {turn.error && (
        <p role="alert" className="mt-2 rounded-md border border-[var(--warn)] px-3 py-2 text-sm text-[var(--warn)]">
          {turn.error}
        </p>
      )}
      {turn.reports.map((id) => (
        <ReportCard key={id} id={id} />
      ))}
      {turn.usage && (
        <p className="mt-2 font-mono text-[11px] text-[var(--muted)]">
          {turn.usage.inputTokens.toLocaleString("en-IN")} in · {turn.usage.outputTokens.toLocaleString("en-IN")} out · est. {fmtCost(turn.usage.costUsd)}
        </p>
      )}
    </div>
  );
}

export function Chat({ initialId, initialMessages, canRun }: { initialId: number | null; initialMessages: AssistantMessage[]; canRun: boolean }) {
  const router = useRouter();
  const [sessionId, setSessionId] = useState(initialId);
  const [messages, setMessages] = useState(initialMessages);
  const [turn, setTurn] = useState<AssistantTurn | null>(null);
  const [running, setRunning] = useState(false);
  const [input, setInput] = useState("");
  const [holdings, setHoldings] = useState(false);
  const [model, setModel] = useState(MODELS[0].id);
  const abort = useRef<AbortController | null>(null);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(MODEL_KEY);
      if (saved && MODELS.some((m) => m.id === saved)) setModel(saved);
    } catch {}
  }, []);
  useEffect(() => end.current?.scrollIntoView({ block: "end" }), [messages, turn]);

  function pickModel(id: string) {
    setModel(id);
    try {
      localStorage.setItem(MODEL_KEY, id);
    } catch {}
  }

  async function send() {
    const text = input.trim();
    if (!text || running || !canRun) return;
    setMessages((m) => [...m, { role: "user", text }]);
    setInput("");
    setRunning(true);
    let t = emptyTurn();
    setTurn(t);
    const ac = new AbortController();
    abort.current = ac;
    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: sessionId ?? undefined, message: text, holdings, model }),
        signal: ac.signal,
      });
      if (!res.ok || !res.body) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        t = { ...t, error: j.error === "busy" ? "The assistant is busy with another request." : (j.error ?? `The request failed (${res.status}).`) };
      } else {
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          const parsed = splitSse(buf + dec.decode(value, { stream: true }));
          buf = parsed.rest;
          for (const ev of parsed.events) {
            if (ev.type === "session") {
              const id = (ev.data as { id: number }).id;
              setSessionId(id);
              window.history.replaceState(null, "", `/assistant?s=${id}`);
            } else {
              t = applyEvent(t, ev.data as AssistantEvent);
              setTurn(t);
            }
          }
        }
      }
    } catch (e) {
      t = { ...t, error: (e as Error).name === "AbortError" ? "Stopped" : "The connection was lost." };
    }
    setMessages((m) => [...m, t]);
    setTurn(null);
    setRunning(false);
    abort.current = null;
    router.refresh();
  }

  const empty = messages.length === 0 && !turn;
  return (
    <div className="flex min-h-[70vh] flex-col">
      <div className="flex-1 space-y-5 pb-4">
        {empty && (
          <div className="py-10 text-center">
            <h1 className="text-xl font-semibold">Research assistant</h1>
            <p className="mt-1 text-sm text-[var(--muted)]">Pulls your data, runs the numbers and shows every step. Ideas for your own research, not advice.</p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              {STARTERS.map((s) => (
                <button
                  key={s.label}
                  type="button"
                  disabled={!canRun}
                  onClick={() => {
                    setInput(s.text);
                    setHoldings(s.holdings);
                  }}
                  className="rounded-full border border-[var(--border)] px-4 py-1.5 text-sm hover:border-[var(--up)] disabled:opacity-40"
                >
                  {s.label}
                </button>
              ))}
            </div>
            {!canRun && <p className="mt-5 text-sm text-[var(--warn)]">The assistant runs only on your PC (npm run dev). Past chats are listed on the left.</p>}
          </div>
        )}
        {messages.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="ml-auto w-fit max-w-[85%] whitespace-pre-wrap rounded-xl bg-[var(--panel)] px-4 py-2 text-sm">
              {m.text}
            </div>
          ) : (
            <Turn key={i} turn={m} running={false} />
          ),
        )}
        {turn && <Turn turn={turn} running={running} />}
        <div ref={end} />
      </div>
      <div className="sticky bottom-0 bg-[var(--bg)] pb-2">
        <Composer
          value={input}
          onChange={setInput}
          onSend={send}
          onStop={() => abort.current?.abort()}
          running={running}
          disabled={!canRun}
          holdings={holdings}
          onHoldings={setHoldings}
          model={model}
          onModel={pickModel}
        />
      </div>
    </div>
  );
}
