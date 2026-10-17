import { getRepo } from "@/lib/api/server";
import { istDate } from "@/lib/time/ist";
import { ClaudeCard } from "../../components/ClaudeCard";

export const dynamic = "force-dynamic";

export default async function MarketPage() {
  const summary = await getRepo().getDailySummary(istDate(new Date()));
  return <ClaudeCard summary={summary} />;
}
