import { describe, expect, it } from "vitest";
import { deepDiveStats, scoreTone, type ReportTile } from "@/lib/view/deepdive";

const t = (key: string, status: ReportTile["status"], score: number | null): ReportTile =>
  ({ id: 1, instrumentId: 1, key, name: key, status, score, scoreLabel: null, requestedAt: "", completedAt: null, requestedVia: "site", content: null, error: null });

describe("deepDiveStats", () => {
  it("counts by status and averages each stock's score once", () => {
    const s = deepDiveStats([t("A", "done", 60), t("A", "failed", 60), t("B", "done", 80), t("C", "pending", null)]);
    expect(s).toEqual({ total: 4, done: 2, pending: 1, failed: 1, avgScore: 70 });
  });
  it("has no average without scores", () => {
    expect(deepDiveStats([t("A", "done", null)]).avgScore).toBeNull();
    expect(deepDiveStats([]).total).toBe(0);
  });
});

describe("scoreTone", () => {
  it("bands at 60 and 45", () => {
    expect([scoreTone(78), scoreTone(60), scoreTone(59), scoreTone(45), scoreTone(44), scoreTone(null)]).toEqual(["up", "up", "warn", "warn", "down", "muted"]);
  });
});
