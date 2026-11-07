import type { StageResult } from "@/lib/calc/stage";
import { Chip, type Tone } from "./ui";

const TONE: Record<number, Tone> = { 1: "neutral", 2: "up", 3: "warn", 4: "down" };

/** Weinstein stage: S1 grey, S2 green, S3 amber, S4 red; "BO" marks a fresh breakout. The tooltip carries MA30, slope and weeks in stage. */
export function StageChip({ stage }: { stage: StageResult | undefined }) {
  if (!stage || stage.stage === null) return <span title="Not enough history for a stage (needs about 34 weeks)" className="font-mono text-[11px] text-[var(--muted)]">—</span>;
  const tip = `MA30 ${stage.ma30!.toFixed(2)} · slope ${stage.slope! >= 0 ? "+" : ""}${(stage.slope! * 100).toFixed(1)}% over 4 weeks · ${stage.weeksInStage} week${stage.weeksInStage === 1 ? "" : "s"} in stage`;
  return <Chip tone={TONE[stage.stage]!} title={tip}>S{stage.stage}{stage.freshBreakout && " BO"}</Chip>;
}
