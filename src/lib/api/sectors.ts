import { buildRotation, type RotationRow } from "@/lib/calc/rotation";
import type { Repo } from "@/lib/db/repo";
import type { StoredDay } from "@/lib/db/types";
import { SECTOR_KEYS } from "@/lib/instruments";
import { buildSectorRows } from "@/lib/view/dashboard";
import { buildDailyLog, type LogMonth } from "@/lib/view/dailyLog";
import { buildConstituentRows, buildSectorTiles, type ConstituentRow, type SectorTile } from "@/lib/view/sectors";

export interface SectorAnalysis {
  sessionDate: string | null;
  tiles: SectorTile[];
  /** By sector key. */
  constituents: Record<string, ConstituentRow[]>;
  rotation: RotationRow[];
  /** Any sector has members. */
  hasConstituents: boolean;
  /** The Daily Sector Log: the current month and 5 before, newest first. */
  dailyLog: LogMonth[];
}

// ~140 sessions: the 5/21/63-session returns and 9+ week ends for the rotation, and 6 months of daily log.
const DAYS = 140;

/**
 * Fixed query count: one instruments query, getDays for each sector and Nifty, one
 * listConstituents per sector and a single getDaysOn for every member on the session date.
 */
export async function loadSectorAnalysis(repo: Repo): Promise<SectorAnalysis> {
  const instruments = await repo.listInstruments({ types: ["index", "sector"] });
  const nifty = instruments.find((i) => i.key === "NIFTY50");
  // Only sectors the database knows, in SECTOR_KEYS order (all 11 in production).
  const sectors = SECTOR_KEYS.flatMap((k) => instruments.find((i) => i.key === k) ?? []);

  const [niftyDays, series, memberLists] = await Promise.all([
    nifty ? repo.getDays(nifty.id, DAYS) : Promise.resolve([] as StoredDay[]),
    Promise.all(sectors.map(async (s) => ({ key: s.key, name: s.name, days: await repo.getDays(s.id, DAYS) }))),
    Promise.all(sectors.map((s) => repo.listConstituents(s.key))),
  ]);
  const niftyDates = niftyDays.filter((d) => d.close !== null).map((d) => d.date);
  const sessionDate = niftyDates.at(-1) ?? null;

  const memberIds = [...new Set(memberLists.flat().map((m) => m.id))];
  const stored = sessionDate && memberIds.length > 0 ? await repo.getDaysOn(memberIds, sessionDate) : new Map<number, StoredDay>();

  const constituents: Record<string, ConstituentRow[]> = {};
  sectors.forEach((s, i) => {
    const members = memberLists[i];
    const dayOf = new Map(members.flatMap((m) => {
      const d = stored.get(m.id);
      return d ? [[m.key, d] as const] : [];
    }));
    constituents[s.key] = buildConstituentRows(members.map((m) => ({ key: m.key, name: m.name })), dayOf);
  });

  const latest = new Map(series.map((s) => [s.key, [...s.days].reverse().find((d) => d.close !== null) ?? null]));
  const rows = buildSectorRows(series, niftyDates).filter((r) => sectors.some((s) => s.key === r.key));

  return {
    sessionDate,
    tiles: buildSectorTiles(rows, latest, new Map(Object.entries(constituents))),
    constituents,
    rotation: buildRotation(series, niftyDates),
    hasConstituents: memberLists.some((m) => m.length > 0),
    dailyLog: buildDailyLog(
      { NIFTY50: niftyDays, ...Object.fromEntries(series.map((s) => [s.key, s.days])) },
      niftyDates,
      new Date(),
    ),
  };
}
