/**
 * Fundamental Quality (0-100) is an independent module that stays NOT AVAILABLE until a data provider is approved
 * (Yahoo Finance is experimental only: coverage, quality, licensing and reliability are still being evaluated).
 * It never contributes to Technical Strength or Trade Quality, and a missing value is never a zero.
 *
 * This file fixes the shape of the data a provider must supply, so the provider can be swapped without touching scoring.
 * No scoring formulas are written yet: they depend on which fields a provider can actually deliver for Indian stocks,
 * and guessing them would invent numbers.
 */
export type PeriodKind = "quarterly" | "annual" | "ttm";
export type CompanyKind = "non-financial" | "bank" | "nbfc" | "insurer" | "other-financial";

export interface FinancialPeriod {
  kind: PeriodKind;
  /** Period end date, YYYY-MM-DD. */
  periodEnd: string;
  revenue: number | null;
  netProfit: number | null;
  eps: number | null;
  operatingMarginPct: number | null;
  netMarginPct: number | null;
  operatingCashFlow: number | null;
  freeCashFlow: number | null;
}

export interface FinancialSnapshot {
  symbol: string;
  companyKind: CompanyKind;
  /** Where the numbers came from and when they were fetched: required for every value shown. */
  provider: string;
  fetchedAt: string;
  periods: FinancialPeriod[];
  roePct: number | null;
  rocePct: number | null;
  debtToEquity: number | null;
  interestCoverage: number | null;
  pe: number | null;
  pb: number | null;
  evToEbitda: number | null;
  marketCap: number | null;
}

export interface FundamentalProvider {
  name: string;
  /** null when the provider has nothing for the symbol; never a fabricated or partial guess. */
  getFinancials(symbol: string): Promise<FinancialSnapshot | null>;
}

export interface FundamentalResult {
  status: "NOT AVAILABLE";
  score: null;
  reason: string;
}

/** Until formulas exist and a provider is approved this always reports NOT AVAILABLE, with the reason. */
export function fundamentalQuality(data: FinancialSnapshot | null): FundamentalResult {
  if (data === null) return { status: "NOT AVAILABLE", score: null, reason: "No approved fundamental data provider" };
  return { status: "NOT AVAILABLE", score: null, reason: "Fundamental scoring rules are not enabled until a provider is approved and its coverage evaluated" };
}

/** Upcoming-event inputs for the event-risk part of Trade Quality (not scored yet). */
export type EventKind = "earnings" | "dividend" | "split" | "bonus" | "announcement" | "regulatory";
export interface UpcomingEvent { symbol: string; kind: EventKind; date: string; source: string }
export interface EventProvider {
  name: string;
  getUpcomingEvents(symbol: string, fromDate: string, toDate: string): Promise<UpcomingEvent[] | null>;
}
/** Event risk is UNKNOWN, never "no risk", when no provider exists. */
export const EVENT_RISK_STATUS = "UNKNOWN / NOT AVAILABLE" as const;
