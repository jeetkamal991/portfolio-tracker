import type { ReactNode } from "react";
import type { Trend } from "@/lib/calc/levels";
import type { ConstituentRow, SectorTile } from "@/lib/view/sectors";
import { ScoreLabelChip } from "../popup/ScoreBadge";
import { StockLink } from "../popup/StockLink";
import { Label, Panel, PctText } from "../ui";
import { ConstituentTable } from "./ConstituentTable";

const TREND: Record<Trend, string> = { above_both: "Above 50 & 200", between: "Between 50 & 200", below_both: "Below 50 & 200" };

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <Label>{label}</Label>
      <div className="text-sm">{children}</div>
    </div>
  );
}

export function SectorDetail({ tile, rows }: { tile: SectorTile; rows: ConstituentRow[] }) {
  return (
    <Panel
      title={tile.name}
      action={
        <StockLink
          stockKey={tile.key}
          className="rounded-md border border-[var(--border)] px-3 py-1 font-mono text-xs hover:border-[var(--up)]"
        >
          View chart
        </StockLink>
      }
    >
      <div className="mb-5 grid grid-cols-3 gap-4 sm:grid-cols-4 lg:grid-cols-7">
        <Stat label="1D"><PctText value={tile.d1} /></Stat>
        <Stat label="1W"><PctText value={tile.w1} /></Stat>
        <Stat label="1M"><PctText value={tile.m1} /></Stat>
        <Stat label="3M"><PctText value={tile.m3} /></Stat>
        <Stat label="Trend">
          <span className="text-[var(--muted)]">{tile.trend ? TREND[tile.trend] : "—"}</span>
        </Stat>
        <Stat label="RS vs Nifty 4W"><PctText value={tile.rsVsNifty} /></Stat>
        <Stat label="Score">
          {tile.scoreLabel ? <ScoreLabelChip label={tile.scoreLabel} score={tile.score ?? undefined} /> : "—"}
        </Stat>
      </div>
      <ConstituentTable rows={rows} />
    </Panel>
  );
}
