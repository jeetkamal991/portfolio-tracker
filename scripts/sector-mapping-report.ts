// READ-ONLY. Writes docs/reports/sector-mapping.csv: for every universe stock, its NSE industry (official niftyindices
// constituent files), the sector index it maps to today, why it has none, and a SUGGESTION only where the industry
// matches exactly one tracked sector index. Nothing is assigned automatically.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createSupabaseRepo } from "@/lib/db/supabaseRepo";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseCsvLine } from "@/lib/instruments";
import { primarySector } from "@/lib/universe/sectors";
import { listUniverseStocks } from "@/lib/universe/stocks";

const DIR = "data/niftyindices/constituents";
/** Industry -> the one tracked sector index that covers it. Anything not listed gets no suggestion. */
const ONE_TO_ONE: Record<string, string> = {
  "Information Technology": "NIFTY_IT",
  "Fast Moving Consumer Goods": "NIFTY_FMCG",
  "Automobile and Auto Components": "NIFTY_AUTO",
  "Metals & Mining": "NIFTY_METAL",
  "Media Entertainment & Publication": "NIFTY_MEDIA",
  "Healthcare": "NIFTY_HEALTHCARE",
};
/** Industries that no tracked sector index covers (the 11 tracked: Auto, Bank, Fin, FMCG, IT, Media, Metal, Pharma, PSU Bank, Pvt Bank, Healthcare). */
const UNTRACKED = new Set(["Capital Goods", "Power", "Oil Gas & Consumable Fuels", "Consumer Durables", "Realty", "Chemicals", "Telecommunication", "Services", "Consumer Services", "Construction Materials", "Construction", "Textiles", "Forest Materials", "Diversified"]);

function industries(): Map<string, string> {
  const m = new Map<string, string>();
  for (const f of readdirSync(DIR).filter((n) => n.endsWith(".csv"))) {
    const lines = readFileSync(`${DIR}/${f}`, "utf8").replace(/^﻿/, "").split(/\r?\n/).filter(Boolean);
    const h = parseCsvLine(lines[0]!).map((x) => x.trim().toLowerCase());
    const iSym = h.indexOf("symbol"), iInd = h.indexOf("industry");
    if (iSym < 0 || iInd < 0) continue;
    for (const l of lines.slice(1)) {
      const c = parseCsvLine(l);
      if (c[iSym] && c[iInd]) m.set(c[iSym]!.trim(), c[iInd]!.trim());
    }
  }
  return m;
}

const csv = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

async function main() {
  process.loadEnvFile(".env.local");
  const repo = createSupabaseRepo(createAdminClient());
  const ind = industries();
  const keysOf = new Map<number, string[]>();
  for (const m of await repo.listMemberships()) keysOf.set(m.instrumentId, [...(keysOf.get(m.instrumentId) ?? []), m.indexKey]);
  const sectorRows = new Map<string, number>();
  for (const i of await repo.listInstruments({ types: ["sector"], activeOnly: true })) sectorRows.set(i.key, (await repo.getDays(i.id, 5000)).filter((d) => d.close !== null).length);

  const out = ["symbol,name,nse_industry,current_sector_index,all_index_memberships,sector_index_rows,unmapped_reason,suggested_index,suggestion_basis"];
  const tally = new Map<string, number>();
  for (const s of (await listUniverseStocks(repo)).sort((a, b) => a.key.localeCompare(b.key))) {
    const memberships = (keysOf.get(s.id) ?? []).filter((k) => k !== "NIFTY200");
    const sector = primarySector(keysOf.get(s.id) ?? []);
    const industry = ind.get(s.key) ?? "";
    let reason = "", suggested = "", basis = "";
    if (sector) {
      if ((sectorRows.get(sector) ?? 0) < 300) reason = `Mapped to ${sector}, but that index has only ${sectorRows.get(sector)} stored sessions (sector-relative scoring unavailable)`;
    } else if (!industry) {
      reason = "Not a member of any tracked sector index, and not in any constituents file (industry unknown)";
    } else if (ONE_TO_ONE[industry]) {
      reason = `Not a constituent of ${ONE_TO_ONE[industry]} (the index holds only its largest members)`;
      suggested = ONE_TO_ONE[industry]!;
      basis = `NSE industry "${industry}" matches exactly one tracked sector index; peer-group benchmark, NOT an index member: confirm before use`;
    } else if (industry === "Financial Services") {
      reason = "Not a member of Nifty Bank, Financial Services, PSU Bank or Pvt Bank";
      basis = "NSE industry Financial Services spans banks, NBFCs, insurers and asset managers: ambiguous, no suggestion";
    } else if (UNTRACKED.has(industry)) {
      reason = `No tracked sector index covers the NSE industry "${industry}"`;
      basis = "Would need another sector index (history not stored): no suggestion";
    } else {
      reason = `Industry "${industry}" has no defined mapping`;
    }
    const cat = sector ? (reason ? "mapped, index too short" : "mapped") : suggested ? "unmapped, suggestion available" : "unmapped, no suggestion";
    tally.set(cat, (tally.get(cat) ?? 0) + 1);
    out.push([s.key, s.name, industry, sector ?? "", memberships.join("|"), sector ? String(sectorRows.get(sector) ?? "") : "", reason, suggested, basis].map(csv).join(","));
  }
  if (!existsSync("docs/reports")) mkdirSync("docs/reports", { recursive: true });
  writeFileSync("docs/reports/sector-mapping.csv", out.join("\n") + "\n");
  console.log(`wrote docs/reports/sector-mapping.csv (${out.length - 1} stocks)`);
  for (const [k, n] of tally) console.log(`  ${k}: ${n}`);
  const byInd = new Map<string, number>();
  for (const l of out.slice(1)) {
    const c = parseCsvLine(l);
    if (!c[3]) byInd.set(c[2] || "(industry unknown)", (byInd.get(c[2] || "(industry unknown)") ?? 0) + 1);
  }
  console.log("Unmapped by NSE industry:", [...byInd.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(", "));
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
