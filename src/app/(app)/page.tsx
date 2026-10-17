import { getRepo } from "@/lib/api/server";
import { buildSectorRows } from "@/lib/view/dashboard";
import { PriceChart } from "../components/chart/PriceChart";
import { NiftyCard } from "../components/dashboard/NiftyCard";
import { SectorStrip } from "../components/dashboard/SectorStrip";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const repo = getRepo();
  const instruments = await repo.listInstruments({ types: ["index", "sector"] });
  const nifty = instruments.find((i) => i.key === "NIFTY50");

  const [niftyDays, sectors] = await Promise.all([
    // Full history for the chart's ALL range (~2,700 sessions since 2015).
    nifty ? repo.getDays(nifty.id, 5000) : Promise.resolve([]),
    Promise.all(
      instruments
        .filter((i) => i.type === "sector")
        .map(async (i) => ({ key: i.key, name: i.name, days: await repo.getDays(i.id, 70) })),
    ),
  ]);
  const niftyDates = niftyDays.filter((d) => d.close !== null).map((d) => d.date);

  return (
    <div className="flex flex-col gap-6">
      <NiftyCard days={niftyDays} />
      <PriceChart days={niftyDays} title="NIFTY 50" />
      <SectorStrip rows={buildSectorRows(sectors, niftyDates.slice(-70))} />
    </div>
  );
}
