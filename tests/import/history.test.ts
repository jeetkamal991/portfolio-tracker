import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { HEADER_TO_KEY, parseHistoryWorkbook } from "@/lib/import/history";

const utc = (m: number, d: number) => new Date(Date.UTC(2026, m - 1, d));

async function build(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const a = wb.addWorksheet("OCT");
  a.addRow(["Date ", "NIFTY", "FOO", "Financial ", null]);
  a.addRow(["Total", { formula: "sum(B3:B5)", result: 0.01 }, 0, 0]);
  a.addRow([utc(10, 1), 0.0065, 0.1, 0.002]);
  a.addRow([]);
  a.addRow([utc(10, 2), 0.15, 0.2, null]);
  const b = wb.addWorksheet("SEP");
  b.addRow(["Date ", "NIFTY", "PSU BANK"]);
  b.addRow([utc(9, 30), { formula: "x", result: -0.01 }, -0.003]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe("parseHistoryWorkbook", () => {
  it("maps headers", () => {
    expect(HEADER_TO_KEY["Financial"]).toBe("NIFTY_FIN");
  });

  it("parses rows and report", async () => {
    const { rows, report } = await parseHistoryWorkbook(await build());
    expect(rows).toContainEqual({ key: "NIFTY50", date: "2026-10-01", pct: 0.0065 });
    expect(rows).toContainEqual({ key: "NIFTY_FIN", date: "2026-10-01", pct: 0.002 });
    expect(rows).toContainEqual({ key: "NIFTY50", date: "2026-09-30", pct: -0.01 });
    expect(rows).toContainEqual({ key: "NIFTY_PSU_BANK", date: "2026-09-30", pct: -0.003 });
    expect(rows.some((r) => r.date === "Total")).toBe(false);
    expect(report.sheets).toBe(2);
    expect(report.dates).toBe(3);
    expect(report.values).toBe(rows.length);
    expect(report.blanks).toBe(1);
    expect(report.outliers).toEqual([{ key: "NIFTY50", date: "2026-10-02", pct: 0.15 }]);
    expect(report.unknownHeaders).toEqual(["FOO"]);
  });
});
