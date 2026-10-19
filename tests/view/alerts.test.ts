import { describe, it, expect } from "vitest";
import { lastFiredText, ruleText, telegramIcon } from "@/lib/view/alerts";

describe("alerts view", () => {
  it("describes rules in plain words", () => {
    expect(ruleText({ condition: "price_above", value: 1350 })).toBe("Price goes above ₹1,350.00");
    expect(ruleText({ condition: "cross_ema200", value: null })).toBe("Crosses EMA 200");
    expect(ruleText({ condition: "holding_sl", value: 3400 })).toBe("Near / hit stop loss ₹3,400.00");
  });
  it("last fired in IST, or never", () => {
    expect(lastFiredText("2026-10-16T10:00:00.000Z")).toBe("Last fired 16 Oct 15:30");
    expect(lastFiredText(null)).toBe("Never fired");
  });
  it("Telegram status icons", () => {
    expect(telegramIcon("sent").icon).toBe("✓");
    expect(telegramIcon("failed: chat not found")).toEqual({ icon: "⚠", title: "Telegram failed: chat not found", tone: "warn" });
    expect(telegramIcon("not_configured").icon).toBe("—");
    expect(telegramIcon(null).icon).toBe("—");
  });
});
