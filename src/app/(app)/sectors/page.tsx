import { loadSectorAnalysis } from "@/lib/api/sectors";
import { getRepo } from "@/lib/api/server";
import { fmtDate } from "@/lib/view/dashboard";
import { DailyLog } from "../../components/sectors/DailyLog";
import { RotationPanel } from "../../components/sectors/RotationPanel";
import { SectorDetail } from "../../components/sectors/SectorDetail";
import { SectorGrid } from "../../components/sectors/SectorGrid";
import { Label } from "../../components/ui";

export const dynamic = "force-dynamic";

export default async function SectorsPage({ searchParams }: { searchParams: Promise<{ s?: string; m?: string }> }) {
  const { s, m } = await searchParams;
  const a = await loadSectorAnalysis(getRepo());
  // An unknown ?s= selects nothing (no fallback to the first tile).
  const selected = a.tiles.find((t) => t.key === s) ?? null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-mono text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">Sector Analysis</h1>
        {a.sessionDate && <Label>as of {fmtDate(a.sessionDate)}</Label>}
      </div>
      <SectorGrid tiles={a.tiles} selected={selected?.key ?? null} />
      {selected ? (
        <SectorDetail tile={selected} rows={a.constituents[selected.key] ?? []} />
      ) : (
        <p className="text-sm text-[var(--muted)]">Select a sector to see its stocks.</p>
      )}
      <RotationPanel rows={a.rotation} />
      <DailyLog months={a.dailyLog} monthId={m ?? null} selected={selected?.key ?? null} />
    </div>
  );
}
