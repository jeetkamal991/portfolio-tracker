import { test, expect } from "vitest";
import { activeTab, marketPhase, istClock, TABS } from "@/lib/view/shell";

test("tabs order", () => expect(TABS.map((t) => t.label)).toEqual(["Dashboard", "Portfolio", "Watchlist", "Sector Analysis", "Market", "Rankings", "AI Deep Dive", "Alerts"]));
test("activeTab", () => {
  expect(activeTab("/")).toBe("/");
  expect(activeTab("/sectors")).toBe("/sectors");
  expect(activeTab("/sectors/x")).toBe("/sectors");
  expect(activeTab("/alerts/3")).toBe("/alerts");
  expect(activeTab("/nope")).toBe("/");
});
test("marketPhase boundaries (Fri 16 Oct 2026)", () => {
  expect(marketPhase(new Date("2026-10-16T03:29:00Z"))).toBe("CLOSED"); // 08:59
  expect(marketPhase(new Date("2026-10-16T03:30:00Z"))).toBe("PRE-OPEN"); // 09:00
  expect(marketPhase(new Date("2026-10-16T03:45:00Z"))).toBe("OPEN"); // 09:15
  expect(marketPhase(new Date("2026-10-16T10:00:00Z"))).toBe("OPEN"); // 15:30
  expect(marketPhase(new Date("2026-10-16T10:01:00Z"))).toBe("CLOSED"); // 15:31
  expect(marketPhase(new Date("2026-10-17T04:30:00Z"))).toBe("CLOSED"); // Saturday
});
test("istClock", () => expect(istClock(new Date("2026-10-16T09:35:00Z"))).toBe("15:05 IST"));
