"use client";

import { useState, type ReactNode } from "react";
import { invalidate, mutate, stockUrl } from "@/lib/client/cache";
import { daysToResults, resultsLabel } from "@/lib/calc/resultsRisk";
import { istDate } from "@/lib/time/ist";
import { COMPONENT_MAX, type ScoreComponents } from "@/lib/calc/score";
import { fmtPct, fmtPrice } from "@/lib/view/dashboard";
import type { PopupData } from "@/lib/view/popup";
import { PriceChart } from "../chart/PriceChart";
import { Chip, Label, Panel, PctText, type Tone } from "../ui";
import { ScoreLabelChip } from "./ScoreBadge";

const COMPONENTS: { id: keyof ScoreComponents; label: string }[] = [
  { id: "trend", label: "Trend" },
  { id: "momentum", label: "Momentum" },
  { id: "volume", label: "Volume" },
  { id: "pattern", label: "Pattern" },
  { id: "market", label: "Market" },
  { id: "risk", label: "Risk" },
  { id: "flows", label: "Flows" },
];
const CONFIDENCE: Record<string, Tone> = { High: "up", Medium: "warn", Low: "neutral" };

/** Components are stored with 2 decimals; show one. */
const pts = (n: number) => n.toFixed(1);

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-t border-[var(--border)] py-1.5 first:border-t-0">
      <span className="text-sm text-[var(--muted)]">{label}</span>
      <span className="flex items-center gap-2 font-mono text-sm tabular-nums">{children}</span>
    </div>
  );
}

function PrimarySignal({ score }: { score: PopupData["score"] }) {
  return (
    <Panel title="Primary signal">
      {score ? (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="font-semibold">{score.signal || score.label}</span>
            <Chip tone={CONFIDENCE[score.confidence] ?? "neutral"}>{score.confidence} confidence</Chip>
          </div>
          {COMPONENTS.map((c) => {
            // Scores stored before Flows existed have no value for it; the nightly job rewrites them.
            const v = score.components[c.id] as number | undefined;
            if (v === undefined) return null;
            const ratio = v / COMPONENT_MAX[c.id];
            return (
              <Row key={c.id} label={c.label}>
                <span className="hidden h-1.5 w-16 overflow-hidden rounded bg-slate-800 sm:inline-block" aria-hidden>
                  <span
                    className={`block h-full ${ratio >= 0.6 ? "bg-[var(--up)]" : ratio <= 0.4 ? "bg-[var(--down)]" : "bg-[var(--warn)]"}`}
                    style={{ width: `${Math.max(0, Math.min(1, ratio)) * 100}%` }}
                  />
                </span>
                <span>
                  {pts(v)} <span className="text-[var(--muted)]">/ {COMPONENT_MAX[c.id]}</span>
                </span>
              </Row>
            );
          })}
          {score.partial && <p className="mt-2 text-xs text-[var(--warn)]">Partial data: some inputs were missing.</p>}
        </>
      ) : (
        <p className="text-sm text-[var(--muted)]">Score not available yet</p>
      )}
    </Panel>
  );
}

function Level({
  label,
  value,
  strength,
  manual,
  close,
}: {
  label: string;
  value: number | null;
  strength: "Strong" | "Weak" | null;
  manual: boolean;
  close: number | null;
}) {
  return (
    <Row label={label}>
      {manual && (
        <span title="Manual level" className="rounded border border-amber-400/40 bg-amber-950/70 px-1 text-[10px] font-semibold text-[var(--warn)]">
          M
        </span>
      )}
      {strength && <Chip tone={strength === "Strong" ? "up" : "neutral"}>{strength}</Chip>}
      <span>{fmtPrice(value)}</span>
      {value !== null && close !== null && (
        <span className="text-xs text-[var(--muted)]">{fmtPct((value - close) / close)}</span>
      )}
    </Row>
  );
}

function Levels({ data }: { data: PopupData }) {
  const { levels, range52 } = data;
  const close = data.latest?.close ?? null;
  return (
    <Panel title="Support & resistance">
      <Level label="Resistance" value={levels.resistance} strength={levels.resistanceStrength} manual={levels.resistanceManual} close={close} />
      <Level label="Support" value={levels.support} strength={levels.supportStrength} manual={levels.supportManual} close={close} />
      <Row label="52W high">
        <span>{fmtPrice(range52.high)}</span>
        <PctText value={range52.fromHigh} className="text-xs" />
      </Row>
      <Row label="52W low">
        <span>{fmtPrice(range52.low)}</span>
        <PctText value={range52.fromLow} className="text-xs" />
      </Row>
      {data.instrument.type === "stock" && <ResultsDate key={data.instrument.key} stockKey={data.instrument.key} initial={data.resultsDate ?? null} />}
    </Panel>
  );
}

/** A typed-in next results date; only a warning chip within 7 days, never part of the score. */
function ResultsDate({ stockKey, initial }: { stockKey: string; initial: string | null }) {
  const [date, setDate] = useState(initial ?? "");
  const [error, setError] = useState(false);
  async function save(next: string) {
    const prev = date;
    setDate(next);
    setError(false);
    try {
      const res = await mutate(`/api/results-date/${encodeURIComponent(stockKey)}`, {
        method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ date: next || null }),
      });
      if (!res.ok) throw new Error(String(res.status));
      invalidate(stockUrl(stockKey)); // a reopened pop-up must not show the old date
    } catch {
      setDate(prev);
      setError(true);
    }
  }
  const soon = daysToResults(date, istDate(new Date()));
  return (
    <Row label="Next results (enter manually)">
      {soon !== null && <Chip tone="warn">{resultsLabel(soon)}</Chip>}
      <input
        type="date"
        value={date}
        onChange={(e) => save(e.target.value)}
        aria-label="Next results date"
        className="rounded border border-[var(--border)] bg-[var(--panel-2)] px-1 text-xs text-[var(--text)]"
      />
      {error && <span role="alert" className="text-xs text-[var(--down)]">Could not save</span>}
    </Row>
  );
}

function Tailwinds({ data }: { data: PopupData }) {
  const t = data.tailwinds;
  const isStock = data.instrument.type === "stock";
  return (
    <Panel title="Market & sector tailwinds">
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between gap-2">
            <Label>NIFTY REGIME</Label>
            {t.niftyLabel ? <ScoreLabelChip label={t.niftyLabel} /> : <span className="text-[var(--muted)]">—</span>}
          </div>
          <p className="text-sm">{t.niftyLine}</p>
        </div>
        {isStock && (
          <div className="flex flex-col gap-1 border-t border-[var(--border)] pt-3">
            <div className="flex items-center justify-between gap-2">
              <Label>SECTOR RS (4W){data.instrument.sectorName ? ` · ${data.instrument.sectorName}` : ""}</Label>
              <PctText value={t.sectorRs} className="text-sm" />
            </div>
            <p className="text-sm">{t.sectorLine ?? "Sector comparison not available"}</p>
          </div>
        )}
      </div>
    </Panel>
  );
}

export function ChartSetupTab({ data }: { data: PopupData }) {
  return (
    <div className="flex flex-col gap-4">
      <PriceChart days={data.days} title={data.instrument.key} height={360} historyKey={data.instrument.key} moreHistory={!!data.historyTruncated} />
      <div className="grid gap-4 md:grid-cols-3">
        <PrimarySignal score={data.score} />
        <Levels data={data} />
        <Tailwinds data={data} />
      </div>
    </div>
  );
}
