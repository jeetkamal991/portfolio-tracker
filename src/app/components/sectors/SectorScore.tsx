import type { SectorTile } from "@/lib/view/sectors";
import { ScoreLabelChip } from "../popup/ScoreBadge";

/** Score chip for a sector; a partial score (thin history) is dimmed so it doesn't read as a real Neutral. */
export function SectorScore({ tile }: { tile: SectorTile }) {
  if (!tile.scoreLabel) return null;
  const chip = <ScoreLabelChip label={tile.scoreLabel} score={tile.score ?? undefined} title={tile.scorePartial ? "partial data — limited history" : undefined} />;
  return tile.scorePartial ? <span className="opacity-50">{chip}</span> : chip;
}
