import { expect, test } from "vitest";
import { parseView } from "@/lib/view/marketViews";

test("parseView keeps a known view and falls back to screeners", () => {
  expect(parseView("flows")).toBe("flows");
  expect(parseView("today")).toBe("today");
  expect(parseView("nope")).toBe("screeners");
  expect(parseView(undefined)).toBe("screeners");
});
