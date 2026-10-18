import { loadHoldingsLatest } from "@/lib/api/portfolio";
import { getRepo } from "@/lib/api/server";
import { istDate } from "@/lib/time/ist";
import { PortfolioView } from "../../components/portfolio/PortfolioView";

export const dynamic = "force-dynamic";

export default async function PortfolioPage() {
  const { holdings, latest } = await loadHoldingsLatest(getRepo());
  return <PortfolioView holdings={holdings} latest={latest} today={istDate(new Date())} />;
}
