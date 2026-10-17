import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createSupabaseRepo } from "@/lib/db/supabaseRepo";
import type { Repo } from "@/lib/db/repo";
import { importConstituentFile, parseIndexHistoryCsv, type IndexHistoryRow } from "@/lib/import/niftyindices";
import { SECTOR_KEYS } from "@/lib/instruments";
import { createAdminClient } from "@/lib/supabase/admin";

const THIN_KEYS = ["NIFTY_AUTO", "NIFTY_FIN", "NIFTY_FMCG", "NIFTY_MEDIA", "NIFTY_METAL", "NIFTY_PSU_BANK", "NIFTY_PVT_BANK", "NIFTY_HEALTHCARE"];
const CONSTITUENT_KEYS = ["NIFTY200", ...SECTOR_KEYS];

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const dry = process.argv.includes("--dry-run");
  const root = argValue("--dir") ?? "data/niftyindices";
  const missing: string[] = [];
  const unknown: string[] = [];
  const errors: string[] = [];

  let repo: Repo | null = null;
  if (!dry) {
    process.loadEnvFile(".env.local");
    repo = createSupabaseRepo(createAdminClient());
  }

  // Read instruments once; refreshed only after inserting new ones.
  let idByKey = new Map<string, number>(repo ? (await repo.listInstruments()).map((i) => [i.key, i.id]) : []);

  // 1. Constituents
  const cDir = join(root, "constituents");
  if (!existsSync(cDir)) missing.push("constituents/ (folder)");
  else {
    for (const f of readdirSync(cDir).filter((n) => n.toLowerCase().endsWith(".csv"))) {
      if (!CONSTITUENT_KEYS.includes(f.slice(0, -4))) unknown.push(`constituents/${f}`);
    }
    for (const key of CONSTITUENT_KEYS) {
      const file = join(cDir, `${key}.csv`);
      if (!existsSync(file)) { missing.push(`constituents/${key}.csv`); continue; }
      try {
        const res = await importConstituentFile(repo, key, readFileSync(file, "utf8"), idByKey);
        idByKey = res.idByKey;
        console.log(`constituents ${key}: rows=${res.rows} new instruments=${repo ? res.created : "n/a (dry run)"}`);
      } catch (e) {
        errors.push(`constituents/${key}.csv: ${e instanceof Error ? e.message : e}`);
      }
    }
  }

  // 2. Sector history
  const hDir = join(root, "history");
  if (!existsSync(hDir)) missing.push("history/ (folder)");
  else {
    const files = readdirSync(hDir).filter((n) => n.toLowerCase().endsWith(".csv")).sort();
    const byKey = new Map<string, string[]>();
    for (const f of files) {
      // Longest matching key wins, e.g. NIFTY_PSU_BANK vs a shorter prefix.
      const key = [...THIN_KEYS].sort((a, b) => b.length - a.length).find((k) => f.startsWith(k));
      if (!key) { unknown.push(`history/${f}`); continue; }
      byKey.set(key, [...(byKey.get(key) ?? []), f]);
    }
    for (const key of THIN_KEYS) {
      const fs = byKey.get(key);
      if (!fs) { missing.push(`history/${key}*.csv`); continue; }
      const merged = new Map<string, IndexHistoryRow>();
      for (const f of fs) {
        try {
          const rows = parseIndexHistoryCsv(readFileSync(join(hDir, f), "utf8"));
          for (const r of rows) merged.set(r.date, r);
          console.log(`history ${f}: rows=${rows.length}`);
        } catch (e) {
          errors.push(`history/${f}: ${e instanceof Error ? e.message : e}`);
        }
      }
      const candles = [...merged.values()].sort((a, b) => a.date.localeCompare(b.date)).map((r) => ({ ...r, volume: 0 }));
      console.log(`history ${key}: total rows=${candles.length}`);
      if (repo && candles.length) {
        const inst = await repo.getInstrumentByKey(key);
        if (!inst) { errors.push(`history ${key}: instrument not found`); continue; }
        const CHUNK = 500;
        for (let i = 0; i < candles.length; i += CHUNK) await repo.upsertCandles(inst.id, candles.slice(i, i + CHUNK));
      }
    }
  }

  console.log(`missing: ${missing.length ? missing.join(", ") : "none"}`);
  console.log(`unknown keys: ${unknown.length ? unknown.join(", ") : "none"}`);
  console.log(`errors: ${errors.length ? errors.join("; ") : "none"}`);
  console.log(dry ? "dry run: nothing written" : "done");
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
