import { describe, expect, it } from "vitest";
import { highlightParts, summaryBullets } from "@/lib/content/claude";

describe("summaryBullets", () => {
  it("splits a paragraph into sentences", () => {
    const t = "The Nifty 50 closed at 23,960.60, up 0.63%. India VIX fell 3.39% to 15.19. Ten of the eleven sectors rose.";
    expect(summaryBullets(t)).toEqual([
      "The Nifty 50 closed at 23,960.60, up 0.63%.",
      "India VIX fell 3.39% to 15.19.",
      "Ten of the eleven sectors rose.",
    ]);
  });
  it("uses '- ' lines when Claude wrote them, and caps the count", () => {
    expect(summaryBullets("- One.\n- Two.\n- Three.", 2)).toEqual(["One.", "Two."]);
  });
  it("keeps a single sentence and ignores empty text", () => {
    expect(summaryBullets("Just one sentence")).toEqual(["Just one sentence"]);
    expect(summaryBullets("")).toEqual([]);
  });
});

describe("highlightParts", () => {
  it("picks out levels and percentages with their direction, not plain integers", () => {
    const p = highlightParts("Nifty 50 at 23,960.60 (+5.15%), IT -1.50%, 11 sectors, up 0.63%");
    expect(p.filter((x) => x.tone).map((x) => [x.text, x.tone])).toEqual([
      ["23,960.60", "plain"],
      ["+5.15%", "up"],
      ["-1.50%", "down"],
      ["0.63%", "plain"],
    ]);
    expect(p.map((x) => x.text).join("")).toBe("Nifty 50 at 23,960.60 (+5.15%), IT -1.50%, 11 sectors, up 0.63%");
  });
});
