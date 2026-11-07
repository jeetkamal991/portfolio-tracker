"use client";

import { useEffect, useState } from "react";
import { evaluationUrl, fetchCached, peek, TTL_MS } from "@/lib/client/cache";
import { tone, type DataStatus, type EvaluationView, type Tone } from "@/lib/view/evaluation";
import { fmtInr } from "@/lib/view/portfolio";
import { Label } from "../ui";

const BAR: Record<Tone, string> = { good: "bg-[var(--up)]", caution: "bg-[var(--warn)]", bad: "bg-[var(--down)]", missing: "bg-slate-600" };
const TEXT: Record<Tone, string> = { good: "text-[var(--up)]", caution: "text-[var(--warn)]", bad: "text-[var(--down)]", missing: "text-[var(--muted)]" };
const STATUS_TONE: Record<DataStatus, Tone> = { AVAILABLE: "good", ESTIMATED: "caution", PROVISIONAL: "caution", "NOT AVAILABLE": "missing", "STALE DATA": "bad" };

type Payload = { evaluation: EvaluationView | null; legacy: { version: string; score: number; label: string | null; date: string } | null; reason?: string };
type State = { key: string; status: "loading" } | { key: string; status: "error" } | { key: string; status: "ready"; data: Payload };

function Bar({ points, max, scored }: { points: number; max: number; scored: boolean }) {
  const t = tone(points, max, scored);
  return (
    <div className="h-1.5 w-full overflow-hidden rounded bg-slate-800" role="img" aria-label={scored ? `${points} of ${max}` : "not scored"}>
      <div className={`h-full ${BAR[t]}`} style={{ width: `${scored && max > 0 ? Math.min(100, (points / max) * 100) : 0}%` }} />
    </div>
  );
}

function StatusChip({ s }: { s: DataStatus }) {
  return <span className={`rounded border border-current px-1.5 py-0.5 font-mono text-[10px] ${TEXT[STATUS_TONE[s]]}`}>{s}</span>;
}

function ScoreCard({ title, score, earned, available, coverage, status, extra }: { title: string; score: number | null; earned: number; available: number; coverage: number; status: DataStatus; extra?: string }) {
  const t = score === null ? "missing" : score >= 65 ? "good" : score >= 50 ? "caution" : "bad";
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--panel-2)] p-3">
      <div className="flex items-center justify-between gap-2">
        <Label>{title}</Label>
        <StatusChip s={status} />
      </div>
      <div className={`mt-1 font-mono text-3xl font-semibold tabular-nums ${TEXT[t]}`}>{score === null ? "—" : score.toFixed(0)}<span className="text-sm text-[var(--muted)]">/100</span></div>
      <p className="mt-1 font-mono text-[11px] text-[var(--muted)]">{earned.toFixed(1)} of {available.toFixed(1)} points scorable · coverage {(coverage * 100).toFixed(0)}%</p>
      {extra && <p className="mt-0.5 text-[11px] text-[var(--muted)]">{extra}</p>}
    </div>
  );
}

function Breakdown({ title, categories }: { title: string; categories: EvaluationView["technical"]["categories"] }) {
  return (
    <section aria-label={title} className="flex flex-col gap-2">
      <Label>{title}</Label>
      {categories.map((c) => {
        const scored = c.available > 0;
        const groups = [...new Set(c.items.map((i) => i.group ?? ""))];
        return (
          <details key={c.key} className="rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-3 py-2">
            <summary className="flex cursor-pointer list-none items-center gap-3">
              <span className="w-44 shrink-0 text-sm">{c.label}</span>
              <div className="flex-1"><Bar points={c.earned} max={c.available} scored={scored} /></div>
              <span className={`w-28 shrink-0 text-right font-mono text-xs tabular-nums ${TEXT[tone(c.earned, c.available, scored)]}`}>
                {scored ? `${c.earned.toFixed(1)}/${c.available.toFixed(0)}` : "n/a"}<span className="text-[var(--muted)]"> of {c.max}</span>
              </span>
            </summary>
            <div className="mt-2 flex flex-col gap-1 border-t border-[var(--border)] pt-2">
              {groups.map((g) => (
                <div key={g || "all"} className="flex flex-col gap-1">
                  {g && <span className="mt-1 font-mono text-[10px] uppercase tracking-wider text-[var(--muted)]">{g}</span>}
                  {c.items.filter((i) => (i.group ?? "") === g).map((i) => {
                    const sc = i.status === "scored";
                    return (
                      <div key={i.key} className="grid grid-cols-[1fr_auto] gap-x-3 text-xs">
                        <span className={sc ? "" : "text-[var(--muted)]"}>{i.label}{i.value !== null && <span className="ml-2 font-mono text-[var(--muted)]">{String(i.value)}</span>}</span>
                        <span className={`text-right font-mono tabular-nums ${TEXT[tone(i.points, i.max, sc)]}`}>{sc ? `${i.points}/${i.max}` : `— /${i.max}`}</span>
                        <span className="col-span-2 text-[11px] text-[var(--muted)]">{sc ? i.note : `Not scored: ${i.note}`}</span>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </details>
        );
      })}
    </section>
  );
}

export function EvaluationTab({ stockKey }: { stockKey: string }) {
  // Shown instantly from the cache when the pop-up already warmed it (it is keyed by stock; the API only ever returns enhanced_v2).
  const [st, setSt] = useState<State>(() => {
    const hit = peek<Payload>(evaluationUrl(stockKey), TTL_MS.evaluation);
    return hit ? { key: stockKey, status: "ready", data: hit.data } : { key: stockKey, status: "loading" };
  });
  useEffect(() => {
    const ctrl = new AbortController();
    const url = evaluationUrl(stockKey);
    const hit = peek<Payload>(url, TTL_MS.evaluation);
    if (hit) setSt({ key: stockKey, status: "ready", data: hit.data });
    (async () => {
      try {
        const r = await fetchCached<Payload>(url, { ttlMs: TTL_MS.evaluation, force: !!hit && !hit.fresh, signal: ctrl.signal });
        if (ctrl.signal.aborted) return;
        if (!r.ok || !r.data) throw new Error(String(r.status));
        setSt({ key: stockKey, status: "ready", data: r.data });
      } catch {
        if (!ctrl.signal.aborted && !hit) setSt({ key: stockKey, status: "error" });
      }
    })();
    return () => ctrl.abort();
  }, [stockKey]);

  if (st.key !== stockKey || st.status === "loading") return <p className="py-8 text-center text-sm text-[var(--muted)]">Loading evaluation…</p>;
  if (st.status === "error") return <p role="alert" className="py-8 text-center text-sm text-[var(--down)]">Could not load the evaluation</p>;
  const { evaluation: e, legacy, reason } = st.data;
  if (!e) return <p className="py-8 text-center text-sm text-[var(--muted)]">{reason ?? "No evaluation yet"}</p>;
  return <EvaluationPanel e={e} legacy={legacy} />;
}

export function EvaluationPanel({ e, legacy }: { e: EvaluationView; legacy: Payload["legacy"] }) {
  const tq = e.tradeQuality, L = tq.levels;
  const dist = (level: number | null) => (level === null || L.entry === null ? "—" : `${(((level - L.entry) / L.entry) * 100).toFixed(1)}%`);

  return (
    <div className="flex flex-col gap-5">
      <section aria-label="Trade assessment" className="flex flex-col gap-2">
        <Label>Trade assessment</Label>
        <div className="grid gap-x-6 gap-y-1 rounded-lg border border-[var(--border)] bg-[var(--panel-2)] p-3 font-mono text-xs tabular-nums sm:grid-cols-2">
          <span>Suggested entry zone: {L.entry === null ? "—" : fmtInr(L.entry, 2)} <span className="text-[var(--muted)]">(latest close)</span></span>
          <span>Stop-loss: {L.stop === null ? "—" : `${fmtInr(L.stop, 2)} (${L.stopSource ?? "—"}) · ${dist(L.stop)}`}</span>
          <span>Target: {L.target === null ? <span className="text-[var(--muted)]">No valid target (breakout territory)</span> : `${fmtInr(L.target, 2)} (${L.targetSource}) · ${dist(L.target)}`}</span>
          <span>Reward-to-risk: {L.rewardRisk === null ? <span className="text-[var(--muted)]">not calculable</span> : L.rewardRisk.toFixed(2)}</span>
          <span>ATR(14): {e.atr?.value == null ? <span className="text-[var(--muted)]">not available</span> : `${fmtInr(e.atr.value, 2)} (${e.atr.pct?.toFixed(2)}% of price)`}</span>
          <span>Median traded value: {e.liquidity?.medianCr == null ? "—" : `₹${e.liquidity.medianCr.toFixed(1)} cr/day`} <span className="text-[var(--muted)]">(estimate)</span></span>
        </div>
        <p className="text-sm">Entry observation: <span className="font-semibold">{tq.observation}</span></p>
        {tq.flags.map((f) => <p key={f} className="text-xs text-[var(--warn)]">⚠ {f}</p>)}
      </section>

      <p className="font-mono text-[11px] text-[var(--muted)]">
        Scoring version {e.scoringVersion} · evaluated on {e.evaluationDate} · data as of {e.dataTimestamp.slice(0, 16).replace("T", " ")} UTC
        {legacy && <> · legacy_v1 score {legacy.score}{legacy.label ? ` (${legacy.label})` : ""}, shown for comparison only</>}
      </p>

      {e.confidence?.status === "LOW CONFIDENCE" && <p role="alert" className="rounded-lg border border-[var(--down)] px-3 py-2 text-sm text-[var(--down)]">LOW CONFIDENCE: data confidence is {e.confidence.score}%. Read the scores with care.</p>}
      {e.confidence?.stale && <p role="alert" className="rounded-lg border border-[var(--warn)] px-3 py-2 text-sm text-[var(--warn)]">STALE DATA: the latest price is more than one trading day old.</p>}
      {e.dataQuality.map((d) => <p key={d.date} className="rounded-lg border border-[var(--warn)] px-3 py-2 text-xs text-[var(--warn)]">⚠ Data quality: {d.note} ({d.sessionsUsed} sessions used)</p>)}

      <div className="grid gap-3 md:grid-cols-4">
        <ScoreCard title="Technical strength" {...{ score: e.technical.score, earned: e.technical.earned, available: e.technical.availablePoints, coverage: e.technical.coverage, status: e.technical.status }} />
        <ScoreCard title="Trade quality" {...{ score: tq.score, earned: tq.earned, available: tq.availablePoints, coverage: tq.coverage, status: tq.status }} extra={tq.rankable ? "Eligible for ranking" : "Not ranked: needs ≥80% coverage and a valid reward-to-risk"} />
        <div className="rounded-lg border border-[var(--border)] bg-[var(--panel-2)] p-3">
          <div className="flex items-center justify-between gap-2"><Label>Fundamental quality</Label><StatusChip s="NOT AVAILABLE" /></div>
          <div className="mt-1 font-mono text-3xl font-semibold text-[var(--muted)]">—</div>
          <p className="mt-1 text-[11px] text-[var(--muted)]">{e.fundamental.note}</p>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--panel-2)] p-3">
          <Label>Data confidence</Label>
          <div className={`mt-1 font-mono text-3xl font-semibold tabular-nums ${e.confidence ? TEXT[e.confidence.status === "OK" ? "good" : "bad"] : "text-[var(--muted)]"}`}>{e.confidence ? e.confidence.score.toFixed(0) : "—"}<span className="text-sm text-[var(--muted)]">%</span></div>
          {e.confidence && <p className="mt-1 font-mono text-[11px] text-[var(--muted)]">freshness {(e.confidence.freshness * 100).toFixed(0)}% · inputs {(e.confidence.requiredInputs * 100).toFixed(0)}% · history {(e.confidence.history * 100).toFixed(0)}%</p>}
          <p className="mt-0.5 text-[11px] text-[var(--muted)]">Separate from score coverage.</p>
        </div>
      </div>

      <Breakdown title="Technical strength breakdown" categories={e.technical.categories} />

      <Breakdown title="Trade quality breakdown" categories={tq.categories} />

      {e.missing.length > 0 && (
        <details className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs text-[var(--muted)]">
          <summary className="cursor-pointer">{e.missing.length} input(s) could not be scored (excluded from coverage, not counted as zero)</summary>
          <ul className="mt-2 list-disc space-y-0.5 pl-4">{e.missing.map((m) => <li key={m}>{m}</li>)}</ul>
        </details>
      )}
      <ul className="list-disc space-y-0.5 pl-4 text-[11px] text-[var(--muted)]">{e.notes.map((n) => <li key={n}>{n}</li>)}</ul>
    </div>
  );
}
