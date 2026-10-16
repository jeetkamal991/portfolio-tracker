import { expect, test } from "vitest";
import { withRetry } from "@/lib/provider/retry";

test("withRetry succeeds on 3rd try with 1s, 2s waits", async () => {
  const waits: number[] = [];
  let n = 0;
  const v = await withRetry(async () => { if (++n < 3) throw new Error("x"); return 7; }, 3, 1000, async (ms) => { waits.push(ms); });
  expect(v).toBe(7);
  expect(waits).toEqual([1000, 2000]);
});

test("withRetry rethrows after 3 failures", async () => {
  await expect(withRetry(async () => { throw new Error("boom"); }, 3, 1, async () => {})).rejects.toThrow("boom");
});
