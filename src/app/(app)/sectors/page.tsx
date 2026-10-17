import { getRepo } from "@/lib/api/server";
import { buildSectorRows } from "@/lib/view/dashboard";
import { SectorHeatmap } from "../../components/SectorHeatmap";

export const dynamic = "force-dynamic";

export default async function SectorsPage({ searchParams }: { searchParams: Promise<{ s?: string }> }) {
  const { s } = await searchParams;
  const repo = getRepo();
  const instruments = await repo.listInstruments({ types: ["index", "sector"] });
  const nifty = instruments.find((i) => i.key === "NIFTY50");
  const [sectors, niftyDays] = await Promise.all([
    Promise.all(
      instruments
        .filter((i) => i.type === "sector")
        .map(async (i) => ({ key: i.key, name: i.name, days: await repo.getDays(i.id, 70) })),
    ),
    // ~70 sessions: the trading calendar for the heatmap's 5/21/63-session returns.
    nifty ? repo.getDays(nifty.id, 70) : Promise.resolve([]),
  ]);
  const niftyDates = niftyDays.filter((d) => d.close !== null).map((d) => d.date);
  return <SectorHeatmap rows={buildSectorRows(sectors, niftyDates)} selected={s ?? null} />;
}
