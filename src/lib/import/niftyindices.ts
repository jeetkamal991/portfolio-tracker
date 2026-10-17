import { parseCsvLine } from "@/lib/instruments";

export interface ConstituentRow { symbol: string; name: string; series: string }
export interface IndexHistoryRow { date: string; open: number; high: number; low: number; close: number }

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function headerIndex(csv: string): { header: string[]; rows: string[][] } {
  const lines = csv.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length === 0) return { header: [], rows: [] };
  return {
    header: parseCsvLine(lines[0]).map((h) => h.trim().toLowerCase()),
    rows: lines.slice(1).map((l) => parseCsvLine(l).map((v) => v.trim())),
  };
}

export function parseConstituentsCsv(csv: string): ConstituentRow[] {
  const { header, rows } = headerIndex(csv);
  if (header.length === 0) return [];
  const iSym = header.indexOf("symbol");
  const iName = header.indexOf("company name");
  const iSeries = header.indexOf("series");
  if (iSym < 0 || iName < 0 || iSeries < 0) throw new Error("constituents CSV: missing Symbol / Company Name / Series column");
  return rows
    .filter((f) => f[iSym])
    .map((f) => ({ symbol: f[iSym], name: f[iName], series: f[iSeries] }));
}

function toIsoDate(s: string): string | null {
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return s;
  m = /^(\d{1,2})[-\s]([A-Za-z]{3})[A-Za-z]*[-\s](\d{4})$/.exec(s);
  if (!m) return null;
  const mo = MONTHS.indexOf(m[2].toLowerCase());
  if (mo < 0) return null;
  return `${m[3]}-${String(mo + 1).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}

function toNum(s: string | undefined): number | null {
  if (s === undefined) return null;
  const t = s.replace(/,/g, "").trim();
  if (t === "" || t === "-") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export function parseIndexHistoryCsv(csv: string): IndexHistoryRow[] {
  const { header, rows } = headerIndex(csv);
  if (header.length === 0) return [];
  const [iD, iO, iH, iL, iC] = ["date", "open", "high", "low", "close"].map((h) => header.indexOf(h));
  if ([iD, iO, iH, iL, iC].some((i) => i < 0)) throw new Error("history CSV: missing Date / Open / High / Low / Close column");
  const byDate = new Map<string, IndexHistoryRow>();
  for (const f of rows) {
    const date = toIsoDate(f[iD] ?? "");
    const [open, high, low, close] = [iO, iH, iL, iC].map((i) => toNum(f[i]));
    if (!date || open === null || high === null || low === null || close === null) continue;
    byDate.set(date, { date, open, high, low, close });
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}
