import { correlation, csRank, delta, log, map1, map2, returns, sign, signedPower, stddev, tsArgmax, type Matrix } from "./ops";

/** Stock x date matrices of the same shape, oldest to newest. */
export interface Panel {
  open: Matrix;
  high: Matrix;
  low: Matrix;
  close: Matrix;
  volume: Matrix;
}

export type AlphaId = "a001" | "a002" | "a006" | "a012" | "a054" | "a101";

export interface AlphaDef {
  id: AlphaId;
  title: string;
  theme: string;
  paperNo: number;
  minBars: number;
  /** One value per stock for the newest date; NaN when it cannot be scored. */
  compute(p: Panel): number[];
}

const lastCol = (m: Matrix): number[] => m.map((row) => row[row.length - 1] ?? Number.NaN);

// All formulas: Z. Kakushadze (2015), "101 Formulaic Alphas", arXiv:1601.00991. rank() is cross-sectional.
export const ALPHAS: AlphaDef[] = [
  {
    // Alpha #1: rank(ts_argmax(signedpower(((returns < 0) ? stddev(returns, 20) : close), 2), 5)) - 0.5
    id: "a001",
    title: "Reversal after weak days",
    theme: "reversal · volatility",
    paperNo: 1,
    minBars: 25,
    compute: (p) => {
      const r = returns(p.close);
      const sd = stddev(r, 20);
      const base = p.close.map((row, i) =>
        row.map((c, t) => (Number.isNaN(r[i][t]) ? Number.NaN : r[i][t] < 0 ? sd[i][t] : c)),
      );
      return lastCol(csRank(tsArgmax(signedPower(base, 2), 5))).map((v) => v - 0.5);
    },
  },
  {
    // Alpha #2: -1 * correlation(rank(delta(log(volume), 2)), rank((close - open) / open), 6)
    id: "a002",
    title: "Volume change vs intraday move",
    theme: "volume · reversal",
    paperNo: 2,
    minBars: 10,
    compute: (p) => {
      const volRank = csRank(delta(log(p.volume), 2));
      const moveRank = csRank(map2(p.close, p.open, (c, o) => (c - o) / o));
      return lastCol(correlation(volRank, moveRank, 6)).map((v) => -v);
    },
  },
  {
    // Alpha #6: -1 * correlation(open, volume, 10)
    id: "a006",
    title: "Open price vs volume",
    theme: "volume · reversal",
    paperNo: 6,
    minBars: 10,
    compute: (p) => lastCol(correlation(p.open, p.volume, 10)).map((v) => -v),
  },
  {
    // Alpha #12: sign(delta(volume, 1)) * (-1 * delta(close, 1))
    id: "a012",
    title: "Volume-confirmed reversal",
    theme: "volume · reversal",
    paperNo: 12,
    minBars: 2,
    compute: (p) => lastCol(map2(sign(delta(p.volume, 1)), delta(p.close, 1), (s, d) => s * -d)),
  },
  {
    // Alpha #54: -1 * ((low - close) * open^5) / ((low - high) * close^5); NaN on a flat bar
    id: "a054",
    title: "Close inside the day's range",
    theme: "price range",
    paperNo: 54,
    minBars: 1,
    compute: (p) => {
      const num = map2(map2(p.low, p.close, (l, c) => l - c), map1(p.open, (o) => o ** 5), (a, b) => a * b);
      const den = map2(map2(p.low, p.high, (l, h) => l - h), map1(p.close, (c) => c ** 5), (a, b) => a * b);
      return lastCol(map2(num, den, (n, d) => -n / d));
    },
  },
  {
    // Alpha #101: (close - open) / ((high - low) + 0.001)
    id: "a101",
    title: "Intraday momentum",
    theme: "intraday",
    paperNo: 101,
    minBars: 1,
    compute: (p) =>
      lastCol(map2(map2(p.close, p.open, (c, o) => c - o), map2(p.high, p.low, (h, l) => h - l + 0.001), (n, d) => n / d)),
  },
];
