import type { PortfolioWarning } from "@/lib/view/portfolio";
import { fmtInr } from "@/lib/view/portfolio";
import { StockLink } from "../popup/StockLink";
import { Chip, Panel, type Tone } from "../ui";

const KIND: Record<PortfolioWarning["status"], { text: string; tone: Tone; level: string }> = {
  SL_HIT: { text: "STOP LOSS HIT", tone: "down", level: "SL" },
  NEAR_SL: { text: "STOP LOSS NEAR", tone: "warn", level: "SL" },
  TARGET_HIT: { text: "TARGET HIT", tone: "up", level: "T1" },
  NEAR_TARGET: { text: "TARGET NEAR", tone: "warn", level: "T1" },
  OK: { text: "OK", tone: "neutral", level: "" },
};

export function WarningsBar({ warnings }: { warnings: PortfolioWarning[] }) {
  if (warnings.length === 0) return null;
  return (
    <Panel title="RISK ALERTS" className="border-[color-mix(in_srgb,var(--warn)_40%,var(--border))]">
      <ul className="flex flex-wrap gap-2">
        {warnings.map((w) => {
          const k = KIND[w.status];
          return (
            <li key={w.key}>
              <StockLink stockKey={w.key} className="block">
                <Chip tone={k.tone}>
                  {w.key} · {k.text} · CMP {fmtInr(w.cmp, 0)} · {k.level} {fmtInr(w.level, 0)}
                </Chip>
              </StockLink>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
