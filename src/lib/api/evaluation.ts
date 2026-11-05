import type { Repo } from "@/lib/db/repo";
import { SCORING_VERSION } from "@/lib/calc/scoreV2/config";
import { buildEvaluationView } from "@/lib/view/evaluation";
import type { ApiResult } from "./levels";

/** Latest enhanced_v2 evaluation of a stock, plus its legacy_v1 score shown separately for comparison (never merged). */
export async function handleEvaluationGet(repo: Repo, key: string): Promise<ApiResult> {
  const inst = await repo.getInstrumentByKey(key);
  if (!inst || inst.type !== "stock") return { status: 404, body: { error: "not_found" } };
  const [snap, latest] = await Promise.all([repo.getSnapshot(inst.id, SCORING_VERSION), repo.getLatestDay(inst.id)]);
  const legacy = latest && latest.score !== null ? { version: "legacy_v1", score: latest.score, label: latest.scoreLabel, date: latest.date } : null;
  if (!snap) return { status: 200, body: { evaluation: null, legacy, reason: "No enhanced_v2 snapshot has been generated for this stock yet" } };
  return { status: 200, body: { evaluation: buildEvaluationView(snap), legacy } };
}
