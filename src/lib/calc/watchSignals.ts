import type { StoredDay } from "@/lib/db/types";

export type SignalBias = "bullish" | "bearish" | "neutral";

export interface WatchSignal {
  key: string;
  name: string;
  date: string;
  label: string;
  bias: SignalBias;
}

export interface WatchSignals {
  crosses: WatchSignal[];
}

interface StockInput {
  key: string;
  name: string;
  days: StoredDay[];
}

const WINDOW = 6; // 5 sessions plus the baseline row before them

interface CrossDef {
  a: (d: StoredDay) => number | null;
  b: (d: StoredDay) => number | null;
  up: string;
  down: string;
}

const CROSSES: CrossDef[] = [
  { a: (d) => d.ema50, b: (d) => d.ema200, up: "Golden cross (EMA 50 / 200)", down: "Death cross (EMA 50 / 200)" },
  { a: (d) => d.ema20, b: (d) => d.ema50, up: "EMA 20 crossed above EMA 50", down: "EMA 20 crossed below EMA 50" },
  { a: (d) => d.close, b: (d) => d.ema200, up: "Closed above EMA 200", down: "Closed below EMA 200" },
];

// -1 below, 1 above, 0 equal or unknown; a cross needs strictly opposite sides on consecutive rows
function side(d: StoredDay, def: CrossDef): number {
  const a = def.a(d);
  const b = def.b(d);
  if (a == null || b == null) return 0;
  return a > b ? 1 : a < b ? -1 : 0;
}

function byNewestThenKey(x: WatchSignal, y: WatchSignal): number {
  if (x.date !== y.date) return x.date < y.date ? 1 : -1;
  return x.key < y.key ? -1 : x.key > y.key ? 1 : 0;
}

export function runWatchSignals(stocks: StockInput[], session: string): WatchSignals {
  const crosses: WatchSignal[] = [];

  for (const s of stocks) {
    const rows = s.days.slice(-WINDOW);
    if (rows.length === 0 || rows[rows.length - 1].date !== session) continue;

    for (let i = 1; i < rows.length; i++) {
      for (const def of CROSSES) {
        const prev = side(rows[i - 1], def);
        const cur = side(rows[i], def);
        if (prev === 0 || cur === 0 || prev === cur) continue;
        const up = cur > 0;
        crosses.push({ key: s.key, name: s.name, date: rows[i].date, label: up ? def.up : def.down, bias: up ? "bullish" : "bearish" });
      }
    }
  }

  // stable sort keeps the definition / stored order within a stock and day
  crosses.sort(byNewestThenKey);
  return { crosses };
}
