import type { Repo } from "@/lib/db/repo";
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

/**
 * Imports one constituents file: inserts symbols not yet known (existing names/active flags are
 * never overwritten), then replaces the index's membership. With no repo (dry run) it only parses.
 * A file with no rows throws before any write, so an empty download never wipes a membership.
 */
export async function importConstituentFile(
  repo: Repo | null,
  key: string,
  csv: string,
  idByKey: Map<string, number>,
): Promise<{ rows: number; created: number; idByKey: Map<string, number> }> {
  const rows = parseConstituentsCsv(csv);
  if (rows.length === 0) throw new Error("no constituent rows; membership left unchanged");
  if (!repo) return { rows: rows.length, created: 0, idByKey };
  const fresh = rows.filter((r) => !idByKey.has(r.symbol));
  await repo.upsertInstruments(fresh.map((r) => ({ key: r.symbol, name: r.name, type: "stock" as const, yahooTicker: `${r.symbol}.NS`, active: true })));
  const created = new Set(fresh.map((r) => r.symbol)).size;
  if (created > 0) idByKey = new Map((await repo.listInstruments()).map((i) => [i.key, i.id]));
  const ids = rows.map((r) => idByKey.get(r.symbol)).filter((id): id is number => id !== undefined);
  await repo.replaceConstituents(key, [...new Set(ids)]);
  return { rows: rows.length, created, idByKey };
}
