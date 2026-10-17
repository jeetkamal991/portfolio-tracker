import type { Instrument } from "@/lib/db/types";

type NewInstrument = Omit<Instrument, "id">;

const idx = (key: string, name: string, type: "index" | "sector", yahooTicker: string): NewInstrument => ({
  key, name, type, yahooTicker, active: true,
});

export const INDEX_INSTRUMENTS: NewInstrument[] = [
  idx("NIFTY50", "Nifty 50", "index", "^NSEI"),
  idx("INDIAVIX", "India VIX", "index", "^INDIAVIX"),
  // Sectors, in history-workbook column order.
  idx("NIFTY_AUTO", "Nifty Auto", "sector", "^CNXAUTO"),
  idx("NIFTY_BANK", "Nifty Bank", "sector", "^NSEBANK"),
  idx("NIFTY_FIN", "Nifty Financial Services", "sector", "NIFTY_FIN_SERVICE.NS"),
  idx("NIFTY_FMCG", "Nifty FMCG", "sector", "^CNXFMCG"),
  idx("NIFTY_IT", "Nifty IT", "sector", "^CNXIT"),
  idx("NIFTY_MEDIA", "Nifty Media", "sector", "^CNXMEDIA"),
  idx("NIFTY_METAL", "Nifty Metal", "sector", "^CNXMETAL"),
  idx("NIFTY_PHARMA", "Nifty Pharma", "sector", "^CNXPHARMA"),
  idx("NIFTY_PSU_BANK", "Nifty PSU Bank", "sector", "^CNXPSUBANK"),
  idx("NIFTY_PVT_BANK", "Nifty Private Bank", "sector", "NIFTY_PVT_BANK.NS"),
  idx("NIFTY_HEALTHCARE", "Nifty Healthcare", "sector", "NIFTY_HEALTHCARE.NS"),
];

export const STRIP_KEYS = ["NIFTY50", "NIFTY_BANK", "INDIAVIX"] as const;

/** Sector keys in workbook column order: AUTO, BANK, FIN, FMCG, IT, MEDIA, METAL, PHARMA, PSU BANK, PVT BANK, HEALTHCARE. */
export const SECTOR_KEYS: string[] = INDEX_INSTRUMENTS.filter((i) => i.type === "sector").map((i) => i.key);

export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

export function parseEquityCsv(csv: string): NewInstrument[] {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length === 0) return [];
  const header = parseCsvLine(lines[0]).map((h) => h.trim());
  const iSym = header.indexOf("SYMBOL");
  const iName = header.indexOf("NAME OF COMPANY");
  const iSeries = header.indexOf("SERIES");
  if (iSym < 0 || iName < 0 || iSeries < 0) throw new Error("EQUITY_L.csv: missing SYMBOL / NAME OF COMPANY / SERIES column");
  const rows: NewInstrument[] = [];
  for (const line of lines.slice(1)) {
    const f = parseCsvLine(line).map((v) => v.trim());
    if (f[iSeries] !== "EQ" || !f[iSym]) continue;
    rows.push({ key: f[iSym], name: f[iName], type: "stock", yahooTicker: `${f[iSym]}.NS`, active: true });
  }
  return rows;
}
