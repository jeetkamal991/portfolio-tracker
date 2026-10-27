/** Rows are stocks, columns are dates oldest to newest; NaN means missing. */
export type Matrix = number[][];

const finite = (v: number): number => (Number.isFinite(v) ? v : Number.NaN);

export function map1(m: Matrix, f: (x: number) => number): Matrix {
  return m.map((row) => row.map((x) => finite(f(x))));
}

export function map2(a: Matrix, b: Matrix, f: (x: number, y: number) => number): Matrix {
  return a.map((row, i) => row.map((x, t) => finite(f(x, b[i][t]))));
}

/** Applies f to each full window of w values ending at t; any NaN in the window gives NaN. */
function rolling(m: Matrix, w: number, f: (win: number[]) => number): Matrix {
  return m.map((row) =>
    row.map((_, t) => {
      if (t < w - 1) return Number.NaN;
      const win = row.slice(t - w + 1, t + 1);
      return win.some(Number.isNaN) ? Number.NaN : finite(f(win));
    }),
  );
}

export function delta(m: Matrix, d: number): Matrix {
  return m.map((row) => row.map((x, t) => (t < d ? Number.NaN : finite(x - row[t - d]))));
}

export function returns(m: Matrix): Matrix {
  return m.map((row) => row.map((x, t) => (t < 1 ? Number.NaN : finite(x / row[t - 1] - 1))));
}

/** Sample standard deviation (n - 1), as pandas computes it. */
export function stddev(m: Matrix, w: number): Matrix {
  return rolling(m, w, (win) => {
    const mean = win.reduce((s, x) => s + x, 0) / w;
    return Math.sqrt(win.reduce((s, x) => s + (x - mean) ** 2, 0) / (w - 1));
  });
}

export function correlation(a: Matrix, b: Matrix, w: number): Matrix {
  return a.map((rowA, i) => {
    const rowB = b[i];
    return rowA.map((_, t) => {
      if (t < w - 1) return Number.NaN;
      const x = rowA.slice(t - w + 1, t + 1);
      const y = rowB.slice(t - w + 1, t + 1);
      if (x.some(Number.isNaN) || y.some(Number.isNaN)) return Number.NaN;
      const mx = x.reduce((s, v) => s + v, 0) / w;
      const my = y.reduce((s, v) => s + v, 0) / w;
      let sxy = 0, sxx = 0, syy = 0;
      for (let k = 0; k < w; k++) {
        sxy += (x[k] - mx) * (y[k] - my);
        sxx += (x[k] - mx) ** 2;
        syy += (y[k] - my) ** 2;
      }
      return finite(sxy / Math.sqrt(sxx * syy));
    });
  });
}

/** 0-based position of the window maximum, earliest on ties. */
export function tsArgmax(m: Matrix, w: number): Matrix {
  return rolling(m, w, (win) => win.indexOf(Math.max(...win)));
}

/** Per date, across stocks: average rank for ties divided by the count of non-NaN values, so results fall in (0, 1]. */
export function csRank(m: Matrix): Matrix {
  const out = m.map((row) => row.map(() => Number.NaN));
  const dates = m[0]?.length ?? 0;
  for (let t = 0; t < dates; t++) {
    const valid = m.map((row, i) => ({ i, v: row[t] })).filter((e) => !Number.isNaN(e.v));
    valid.sort((p, q) => p.v - q.v);
    for (let s = 0; s < valid.length; ) {
      let e = s;
      while (e + 1 < valid.length && valid[e + 1].v === valid[s].v) e++;
      const avg = (s + e) / 2 + 1; // 1-based average rank of the tie group
      for (let k = s; k <= e; k++) out[valid[k].i][t] = avg / valid.length;
      s = e + 1;
    }
  }
  return out;
}

export const signedPower = (m: Matrix, p: number): Matrix => map1(m, (x) => Math.sign(x) * Math.abs(x) ** p);
export const sign = (m: Matrix): Matrix => map1(m, Math.sign);
export const log = (m: Matrix): Matrix => map1(m, (x) => (x > 0 ? Math.log(x) : Number.NaN));
