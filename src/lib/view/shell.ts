import { isMarketOpen, istNowParts } from "@/lib/time/ist";

export const TABS: { href: string; label: string }[] = [
  { href: "/", label: "Dashboard" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/watchlist", label: "Watchlist" },
  { href: "/sectors", label: "Sector Analysis" },
  { href: "/market", label: "Market" },
  { href: "/alerts", label: "Alerts" },
];

/** `/` only for exactly `/`; otherwise the tab whose href prefixes the path; unknown paths fall back to `/`. */
export function activeTab(pathname: string): string {
  if (pathname === "/") return "/";
  const hit = TABS.find((t) => t.href !== "/" && (pathname === t.href || pathname.startsWith(`${t.href}/`)));
  return hit ? hit.href : "/";
}

export type MarketPhase = "PRE-OPEN" | "OPEN" | "CLOSED";

/** Mon–Fri IST: 09:00–09:14 PRE-OPEN; 09:15–15:30 OPEN (same rule as isMarketOpen); otherwise CLOSED. */
export function marketPhase(now: Date): MarketPhase {
  if (isMarketOpen(now)) return "OPEN";
  const { weekday, minutes } = istNowParts(now);
  if (weekday >= 1 && weekday <= 5 && minutes >= 9 * 60 && minutes < 9 * 60 + 15) return "PRE-OPEN";
  return "CLOSED";
}

export function istClock(now: Date): string {
  const { minutes } = istNowParts(now);
  const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
  const mm = String(minutes % 60).padStart(2, "0");
  return `${hh}:${mm} IST`;
}
