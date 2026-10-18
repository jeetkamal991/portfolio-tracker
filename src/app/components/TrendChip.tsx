import type { EmaTrend } from "@/lib/calc/levels";
import { Chip, type Tone } from "./ui";

const TREND: Record<EmaTrend, { tone: Tone; label: string }> = {
  above_all: { tone: "up", label: "Above all" },
  mixed: { tone: "warn", label: "Mixed" },
  below_all: { tone: "down", label: "Below all" },
};

/** Price vs EMA 20/50/200; "—" when any EMA is missing. */
export function TrendChip({ trend }: { trend: EmaTrend | null }) {
  return trend ? <Chip tone={TREND[trend].tone}>{TREND[trend].label}</Chip> : <>—</>;
}
