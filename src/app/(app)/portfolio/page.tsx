import { loadHoldingsLatest } from "@/lib/api/portfolio";
import { loadPortfolioSide } from "@/lib/api/portfolioSide";
import { getRepo } from "@/lib/api/server";
import { istDate } from "@/lib/time/ist";
import { PortfolioView } from "../../components/portfolio/PortfolioView";

export const dynamic = "force-dynamic";

export default async function PortfolioPage() {
  const repo = getRepo();
  const [{ holdings, latest }, side] = await Promise.all([loadHoldingsLatest(repo), loadPortfolioSide(repo)]);
  return <PortfolioView holdings={holdings} latest={latest} today={istDate(new Date())} side={side} />;
}
