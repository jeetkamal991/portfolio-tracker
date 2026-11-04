import { expect, test } from "vitest";
import { handleReportDelete } from "@/lib/api/instrument";
import { createMemoryRepo } from "@/lib/db/memoryRepo";

const inst = { id: 1, key: "RELIANCE", name: "Reliance", type: "stock" } as never;

test("listAllReports names the stock, and delete removes only that report", async () => {
  const repo = createMemoryRepo({ instruments: [inst] });
  await repo.requestReport(1);
  await repo.requestReport(1);
  const all = await repo.listAllReports();
  expect(all.map((r) => [r.id, r.key])).toEqual([[2, "RELIANCE"], [1, "RELIANCE"]]);

  expect((await handleReportDelete(repo, "2")).status).toBe(204);
  expect((await repo.listAllReports()).map((r) => r.id)).toEqual([1]);
  // a new report after a delete must not reuse a live id
  expect((await repo.requestReport(1)).id).toBe(2);
});

test("rejects a non-numeric id", async () => {
  const repo = createMemoryRepo();
  expect((await handleReportDelete(repo, "1; drop")).status).toBe(400);
});
