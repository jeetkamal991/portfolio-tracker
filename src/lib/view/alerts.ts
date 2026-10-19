import { CONDITIONS, fmtAlertTime } from "@/lib/calc/alerts";
import type { AlertRule } from "@/lib/db/types";
import { fmtInr } from "./portfolio";

const LABEL = new Map(CONDITIONS.map((c) => [c.id, c.label]));

/** "Price goes above ₹1,350.00", "Crosses EMA 200", "Near / hit stop loss ₹3,400.00". */
export function ruleText(r: Pick<AlertRule, "condition" | "value">): string {
  const label = LABEL.get(r.condition) ?? r.condition;
  return r.value === null ? label : `${label} ${fmtInr(r.value, 2)}`;
}

export function lastFiredText(iso: string | null): string {
  return iso ? `Last fired ${fmtAlertTime(new Date(iso))}` : "Never fired";
}

/** Telegram delivery as an icon and a tooltip. */
export function telegramIcon(status: string | null): { icon: string; title: string; tone: "up" | "warn" | "neutral" } {
  if (status === "sent") return { icon: "✓", title: "Sent to Telegram", tone: "up" };
  if (status?.startsWith("failed")) return { icon: "⚠", title: `Telegram ${status}`, tone: "warn" };
  return { icon: "—", title: "Telegram not connected", tone: "neutral" };
}
