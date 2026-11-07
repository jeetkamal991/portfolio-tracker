import { loadHoldingsLatest } from "@/lib/api/portfolio";
import { loadPortfolioSide } from "@/lib/api/portfolioSide";
import { getRepo } from "@/lib/api/server";
import { istDate } from "@/lib/time/ist";
import { PortfolioView } from "../../components/portfolio/PortfolioView";

export const dynamic = "force-dynamic";

export default async function PortfolioPage() {
  const repo = getRepo();
  const [{ holdings, latest }, side] = await Promise.all([loadHoldingsLatest(repo), loadPortfolioSide(repo)]);
  const dates = await repo.getResultsDates(holdings.map((h) => h.instrumentId)).catch(() => new Map<number, string>()); // optional: never break the page
  const results = Object.fromEntries(holdings.flatMap((h) => (dates.has(h.instrumentId) ? [[h.key, dates.get(h.instrumentId)!]] : [])));
  return <PortfolioView holdings={holdings} latest={latest} today={istDate(new Date())} side={side} results={results} />;
}
