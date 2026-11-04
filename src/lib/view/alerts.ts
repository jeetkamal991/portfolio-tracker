import { istDate } from "@/lib/time/ist";
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

export type EventKind = "stop_hit" | "near_stop" | "target_hit" | "near_target" | "report" | "other";

/** Reads an event's kind from the wording alertMessage and migration 0012 write; anything else is "other". */
export function eventKind(message: string): EventKind {
  const m = message.toLowerCase();
  if (m.startsWith("📄") || m.includes("report is ready")) return "report";
  if (m.includes("stop loss hit")) return "stop_hit";
  if (m.includes("near stop loss")) return "near_stop";
  if (m.includes("target hit")) return "target_hit";
  if (m.includes("near target")) return "near_target";
  return "other";
}

const URGENCY: EventKind[] = ["stop_hit", "near_stop", "target_hit", "near_target", "report", "other"];

/** CSS variable per event kind, shared by the chart pins and the timeline dots. */
export const KIND_COLOR: Record<EventKind, string> = {
  stop_hit: "--down",
  near_stop: "--warn",
  target_hit: "--up",
  near_target: "--up",
  report: "--ema20",
  other: "--muted",
};

/** 0 = most urgent. */
export const urgencyOf = (k: EventKind): number => URGENCY.indexOf(k);

export interface EventMarker {
  /** A candle date (YYYY-MM-DD) the event is pinned to. */
  time: string;
  key: string;
  kind: EventKind;
}

/**
 * Pins alert events onto chart candles: each event goes to the latest candle on or before its IST date,
 * so an event on a weekend or holiday sits on the session before it. Events before the first candle are dropped.
 * `candleDates` must be ascending.
 */
export function eventMarkers(events: { key: string; firedAt: string; message: string }[], candleDates: string[]): EventMarker[] {
  const out: EventMarker[] = [];
  for (const e of events) {
    const day = istDate(new Date(e.firedAt));
    let time: string | null = null;
    for (const d of candleDates) {
      if (d > day) break;
      time = d;
    }
    if (time) out.push({ time, key: e.key, kind: eventKind(e.message) });
  }
  return out;
}
