import ExcelJS from "exceljs";
import { INDEX_INSTRUMENTS } from "@/lib/instruments";
import { createYahooProvider } from "@/lib/provider/yahoo";
import { addDays, istDate } from "@/lib/time/ist";

const THIN_BELOW = 5;

function cellNum(v: ExcelJS.CellValue): number | null {
  if (typeof v === "number") return v;
  if (v && typeof v === "object" && "result" in v && typeof v.result === "number") return v.result;
  return null;
}

async function workbookNiftyPct(): Promise<Map<string, number>> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile("data/history.xlsx");
  const out = new Map<string, number>();
  wb.eachSheet((ws) => {
    ws.eachRow((row) => {
      const d = row.getCell(1).value;
      const pct = cellNum(row.getCell(2).value);
      if (d instanceof Date && pct !== null) out.set(d.toISOString().slice(0, 10), pct);
    });
  });
  return out;
}

async function main() {
  const provider = createYahooProvider();
  const to = istDate(new Date());
  const from = addDays(to, -10);
  let failed = false;
  let nifty: { date: string; close: number }[] = [];

  for (const inst of INDEX_INSTRUMENTS) {
    try {
      const candles = await provider.getDailyHistory(inst.yahooTicker, from, to);
      const last = candles[candles.length - 1];
      const status = candles.length < THIN_BELOW ? "THIN" : "OK";
      console.log(`${status.padEnd(5)} ${inst.key.padEnd(18)} ${inst.yahooTicker.padEnd(24)} candles=${candles.length} last=${last?.date ?? "-"} close=${last?.close ?? "-"}`);
      if (inst.key === "NIFTY50") nifty = candles;
    } catch (e) {
      failed = true;
      console.log(`FAIL  ${inst.key.padEnd(18)} ${inst.yahooTicker.padEnd(24)} ${e instanceof Error ? e.message : e}`);
    }
  }

  // Compare NIFTY50 day % with the workbook on the latest date both have.
  try {
    const book = await workbookNiftyPct();
    for (let i = nifty.length - 1; i >= 1; i--) {
      const wb = book.get(nifty[i].date);
      if (wb === undefined) continue;
      const yahoo = nifty[i].close / nifty[i - 1].close - 1;
      const diff = Math.abs(yahoo - wb);
      const ok = diff <= 0.0005;
      if (!ok) failed = true;
      console.log(`${ok ? "OK   " : "FAIL "} NIFTY50 day% on ${nifty[i].date}: yahoo=${yahoo.toFixed(6)} workbook=${wb.toFixed(6)} diff=${diff.toFixed(6)}`);
      break;
    }
  } catch (e) {
    failed = true;
    console.log(`FAIL  workbook comparison: ${e instanceof Error ? e.message : e}`);
  }
  process.exit(failed ? 1 : 0);
}

main();
