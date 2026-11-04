import { getRepo } from "@/lib/api/server";
import { DeepDiveTiles } from "../../components/deepdive/DeepDiveTiles";

export const dynamic = "force-dynamic";

export default async function DeepDivePage() {
  const reports = await getRepo().listAllReports();
  return <DeepDiveTiles initial={reports} />;
}
