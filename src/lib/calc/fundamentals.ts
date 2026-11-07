// Collect-only Yahoo fundamentals: raw values in, a typed row and coverage out. No unit conversion, no defaults, nothing derived.

export type YahooModule = "financialData" | "summaryDetail" | "defaultKeyStatistics";
export interface Field { key: string; column: string; module: YahooModule }

export const FIELDS: Field[] = [
  { key: "returnOnEquity", column: "return_on_equity", module: "financialData" },
  { key: "returnOnAssets", column: "return_on_assets", module: "financialData" },
  { key: "profitMargins", column: "profit_margins", module: "financialData" },
  { key: "operatingMargins", column: "operating_margins", module: "financialData" },
  { key: "revenueGrowth", column: "revenue_growth", module: "financialData" },
  { key: "earningsGrowth", column: "earnings_growth", module: "financialData" },
  { key: "debtToEquity", column: "debt_to_equity", module: "financialData" },
  { key: "currentRatio", column: "current_ratio", module: "financialData" },
  { key: "totalDebt", column: "total_debt", module: "financialData" },
  { key: "totalCash", column: "total_cash", module: "financialData" },
  { key: "freeCashflow", column: "free_cashflow", module: "financialData" },
  { key: "operatingCashflow", column: "operating_cashflow", module: "financialData" },
  { key: "trailingPE", column: "trailing_pe", module: "summaryDetail" },
  { key: "marketCap", column: "market_cap", module: "summaryDetail" },
  { key: "priceToBook", column: "price_to_book", module: "defaultKeyStatistics" },
];

export const FINANCIAL_INDEXES = ["NIFTY_FIN", "NIFTY_PVT_BANK", "NIFTY_PSU_BANK"];
/** Banks, NBFCs and other financials: ratios like debt-to-equity mean little for them, so coverage is judged separately. */
export const isFinancial = (indexKeys: string[]): boolean => indexKeys.some((k) => FINANCIAL_INDEXES.includes(k));

export interface FundamentalsRow {
  instrumentId: number;
  fetchedOn: string;
  isFinancial: boolean;
  /** By `FIELDS[].key`; null when Yahoo returned nothing usable. */
  values: Record<string, number | null>;
  missing: string[];
  raw: unknown;
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

/** A Yahoo quoteSummary result (or null/anything else for an unknown symbol) as a row. 0 and negatives are values. */
export function toRow(summary: unknown, ctx: { instrumentId: number; fetchedOn: string; isFinancial: boolean }): FundamentalsRow {
  const values: Record<string, number | null> = {};
  const missing: string[] = [];
  for (const f of FIELDS) {
    const mod = isObj(summary) ? summary[f.module] : undefined;
    const v = isObj(mod) ? mod[f.key] : undefined;
    values[f.key] = isNum(v) ? v : null;
    if (!isNum(v)) missing.push(f.key);
  }
  return { ...ctx, values, missing, raw: isObj(summary) ? JSON.parse(JSON.stringify(summary)) : null };
}

export interface GroupCoverage { stocks: number; byField: Record<string, number> }
export interface Coverage { financials: GroupCoverage; others: GroupCoverage }

/** Per group, how many stocks have each field. */
export function coverage(rows: Pick<FundamentalsRow, "isFinancial" | "missing">[]): Coverage {
  const empty = (): GroupCoverage => ({ stocks: 0, byField: Object.fromEntries(FIELDS.map((f) => [f.key, 0])) });
  const out = { financials: empty(), others: empty() };
  for (const r of rows) {
    const g = r.isFinancial ? out.financials : out.others;
    g.stocks++;
    for (const f of FIELDS) if (!r.missing.includes(f.key)) g.byField[f.key]++;
  }
  return out;
}

const COVERAGE_TARGET = 0.8;

/** A plain-text table: present/stocks and percent per field for each group, `<80%` where a group falls short. */
export function formatCoverage(c: Coverage): string {
  const cell = (g: GroupCoverage, key: string) => {
    const n = g.byField[key] ?? 0;
    if (g.stocks === 0) return "-";
    const share = n / g.stocks;
    return `${n}/${g.stocks} ${(share * 100).toFixed(0)}%${share < COVERAGE_TARGET ? " <80%" : ""}`;
  };
  const w = Math.max(...FIELDS.map((f) => f.key.length));
  const lines = [`${"field".padEnd(w)}  ${"non-financials".padEnd(18)}  financials`];
  for (const f of FIELDS) lines.push(`${f.key.padEnd(w)}  ${cell(c.others, f.key).padEnd(18)}  ${cell(c.financials, f.key)}`);
  return lines.join("\n");
}
