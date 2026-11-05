// READ-ONLY performance audit. Runs the REAL page and API data paths with Supabase's fetch instrumented, and reports per
// screen: database requests, how many ran at once, response bytes, summed request time and wall time. Cold = first call
// (empty in-process caches), warm = immediate repeat. NOTE: this machine is not Vercel, so absolute times include this
// machine's network distance to Supabase; compare counts, bytes and waterfalls, and read times as "what a cold lambda would
// pay per round trip" only after subtracting the measured floor.
// Usage: tsx scripts/perf-audit.ts [--only name]

interface Req { url: string; table: string; query: string; start: number; end: number; bytes: number; status: number }
let log: Req[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!url.includes("supabase.co")) return realFetch(input, init);
  const start = performance.now();
  const res = await realFetch(input, init);
  const body = await res.clone().arrayBuffer();
  const u = new URL(url);
  log.push({ url, table: u.pathname.split("/").pop() ?? "", query: u.search, start, end: performance.now(), bytes: body.byteLength, status: res.status });
  return res;
}) as typeof fetch;

const kb = (n: number) => (n / 1024).toFixed(0).padStart(5) + " KB";
const ms = (n: number) => n.toFixed(0).padStart(5) + " ms";

function report(name: string, wall: number, reqs: Req[]) {
  const sum = reqs.reduce((s, r) => s + (r.end - r.start), 0);
  const bytes = reqs.reduce((s, r) => s + r.bytes, 0);
  // max overlap and "waterfall depth" = longest chain of requests that did not overlap
  const events = reqs.flatMap((r) => [[r.start, 1], [r.end, -1]] as [number, number][]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let cur = 0, max = 0;
  for (const [, d] of events) { cur += d; max = Math.max(max, cur); }
  const sorted = [...reqs].sort((a, b) => a.start - b.start);
  let depth = 0, edge = -Infinity;
  for (const r of sorted) if (r.start >= edge - 1) { depth++; edge = r.end; } else edge = Math.max(edge, r.end);
  console.log(`${name.padEnd(26)} wall ${ms(wall)} | ${String(reqs.length).padStart(3)} requests | max parallel ${String(max).padStart(2)} | sequential steps ~${depth} | ${kb(bytes)} | request-time sum ${ms(sum)}`);
  return { reqs };
}

async function timed(name: string, fn: () => Promise<unknown>, detail = false) {
  for (const pass of ["cold", "warm"]) {
    log = [];
    const t = performance.now();
    try { await fn(); } catch (e) { console.log(`${name} ${pass}: ERROR ${e instanceof Error ? e.message : e}`); continue; }
    const wall = performance.now() - t;
    report(`${name} (${pass})`, wall, log);
    if (detail && pass === "cold") {
      const byTable = new Map<string, { n: number; b: number; t: number }>();
      for (const r of log) { const k = r.table; const x = byTable.get(k) ?? { n: 0, b: 0, t: 0 }; x.n++; x.b += r.bytes; x.t += r.end - r.start; byTable.set(k, x); }
      for (const [k, v] of [...byTable.entries()].sort((a, b) => b[1].b - a[1].b).slice(0, 6)) console.log(`      ${k.padEnd(22)} x${String(v.n).padStart(2)} ${kb(v.b)} ${ms(v.t)}`);
      const big = [...log].sort((a, b) => b.bytes - a.bytes)[0];
      if (big) console.log(`      largest: ${big.table} ${kb(big.bytes)} select=${decodeURIComponent(big.query).slice(0, 110)}`);
    }
  }
}

async function main() {
  process.loadEnvFile(".env.local");
  const only = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1] : null;
  const run = (n: string) => !only || only === n;

  // Network floor: the cheapest possible request.
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const db = createAdminClient();
  if (run("floor")) {
    const times: number[] = [];
    for (let i = 0; i < 6; i++) { log = []; const t = performance.now(); await db.from("instruments").select("id").limit(1); times.push(performance.now() - t); }
    times.shift();
    console.log(`network floor (1 tiny request): min ${ms(Math.min(...times))}, median ${ms(times.sort((a, b) => a - b)[2]!)}, max ${ms(Math.max(...times))}`);
    log = [];
    const t = performance.now();
    await Promise.all(Array.from({ length: 8 }, () => db.from("instruments").select("id").limit(1)));
    console.log(`8 tiny requests in parallel: ${ms(performance.now() - t)}`);
  }

  const { getRepo, cached } = await import("@/lib/api/server");
  const repo = getRepo();
  const { handleInstrumentGet } = await import("@/lib/api/instrument");
  const { handleEvaluationGet } = await import("@/lib/api/evaluation");
  const noParams = Promise.resolve({} as never);

  const scenarios: [string, () => Promise<unknown>, boolean][] = [
    ["layout strip", async () => (await import("@/app/(app)/layout")).default({ children: null }), true],
    ["dashboard", async () => (await import("@/app/(app)/page")).default(), true],
    ["portfolio", async () => (await import("@/app/(app)/portfolio/page")).default(), true],
    ["watchlist", async () => (await import("@/app/(app)/watchlist/page")).default(), true],
    ["market", async () => (await import("@/app/(app)/market/page")).default({ searchParams: noParams }), true],
    ["sectors", async () => (await import("@/app/(app)/sectors/page")).default({ searchParams: noParams }), true],
    ["alerts", async () => (await import("@/app/(app)/alerts/page")).default({ searchParams: noParams }), true],
    ["deepdive", async () => (await import("@/app/(app)/deepdive/page")).default(), true],
    ["rankings", async () => (await import("@/app/(app)/rankings/page")).default({ searchParams: noParams }), true],
    ["popup api (HDFCBANK)", () => handleInstrumentGet(repo, "HDFCBANK", { memo: cached }), true],
    ["evaluation api", () => handleEvaluationGet(repo, "HDFCBANK"), true],
    ["history on demand (ALL)", async () => repo.getChartDays((await repo.getInstrumentByKey("HDFCBANK"))!.id, 5000), true],
  ];
  for (const [name, fn, detail] of scenarios) if (run(name.split(" ")[0]!) || run(name)) await timed(name, fn, detail);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
