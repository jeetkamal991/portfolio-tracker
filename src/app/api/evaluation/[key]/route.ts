import type { NextRequest } from "next/server";
import { handleEvaluationGet } from "@/lib/api/evaluation";
import { getRepo } from "@/lib/api/server";
import { timedJson } from "@/lib/api/timing";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const t0 = performance.now();
  const r = await handleEvaluationGet(getRepo(), key);
  return timedJson(r.body, r.status, t0, "evaluation");
}
