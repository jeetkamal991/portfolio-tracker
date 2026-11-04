export type MarketView = "today" | "screeners" | "alphas" | "flows" | "you";

export const MARKET_VIEWS: { id: MarketView; label: string }[] = [
  { id: "today", label: "Today by Claude" },
  { id: "screeners", label: "Screeners" },
  { id: "alphas", label: "Alpha ranks" },
  { id: "flows", label: "Institutional flows" },
  { id: "you", label: "Your stocks" },
];

/** Reads `?v=`; anything unknown opens the Screeners view. */
export function parseView(v: string | undefined): MarketView {
  return MARKET_VIEWS.some((m) => m.id === v) ? (v as MarketView) : "screeners";
}
