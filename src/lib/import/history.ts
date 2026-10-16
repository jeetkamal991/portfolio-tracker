import ExcelJS from "exceljs";

export const HEADER_TO_KEY: Record<string, string> = {
  NIFTY: "NIFTY50",
  AUTO: "NIFTY_AUTO",
  BANK: "NIFTY_BANK",
  Financial: "NIFTY_FIN",
  FMCG: "NIFTY_FMCG",
  IT: "NIFTY_IT",
  MEDIA: "NIFTY_MEDIA",
  METAL: "NIFTY_METAL",
  PHARMA: "NIFTY_PHARMA",
  "PSU BANK": "NIFTY_PSU_BANK",
  "PVT BANK": "NIFTY_PVT_BANK",
  HEALTHCARE: "NIFTY_HEALTHCARE",
};

export interface ImportedRow { key: string; date: string; pct: number }
export interface ImportReport {
  sheets: number;
  dates: number;
  values: number;
  blanks: number;
  outliers: ImportedRow[];
  unknownHeaders: string[];
}

const OUTLIER = 0.1;

function unwrap(v: ExcelJS.CellValue): ExcelJS.CellValue {
  return v && typeof v === "object" && !(v instanceof Date) && "result" in v
    ? ((v.result as ExcelJS.CellValue) ?? null)
    : v;
}

function headerText(v: ExcelJS.CellValue): string {
  const u = unwrap(v);
  if (u === null || u === undefined) return "";
  if (typeof u === "object" && !(u instanceof Date) && "richText" in u) {
    return u.richText.map((t) => t.text).join("").trim();
  }
  return String(u).trim();
}

/** Excel dates arrive as UTC-midnight Dates, so read UTC components. */
function ymd(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

export async function parseHistoryWorkbook(
  buf: Buffer,
): Promise<{ rows: ImportedRow[]; report: ImportReport }> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const rows: ImportedRow[] = [];
  const report: ImportReport = { sheets: 0, dates: 0, values: 0, blanks: 0, outliers: [], unknownHeaders: [] };
  const unknown = new Set<string>();

  wb.eachSheet((ws) => {
    report.sheets++;
    const cols: { col: number; key: string }[] = [];
    ws.getRow(1).eachCell({ includeEmpty: false }, (cell, col) => {
      if (col === 1) return;
      const h = headerText(cell.value);
      if (!h) return;
      const key = HEADER_TO_KEY[h];
      if (key) cols.push({ col, key });
      else unknown.add(h);
    });

    for (let r = 2; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const d = unwrap(row.getCell(1).value);
      if (!(d instanceof Date) || Number.isNaN(d.getTime())) continue;
      const date = ymd(d);
      report.dates++;
      for (const { col, key } of cols) {
        const v = unwrap(row.getCell(col).value);
        if (v === null || v === undefined || v === "") { report.blanks++; continue; }
        if (typeof v !== "number" || !Number.isFinite(v)) { report.blanks++; continue; }
        const item = { key, date, pct: v };
        rows.push(item);
        report.values++;
        if (Math.abs(v) > OUTLIER) report.outliers.push(item);
      }
    }
  });
  report.unknownHeaders = [...unknown];
  return { rows, report };
}
