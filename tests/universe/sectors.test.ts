import { describe, expect, it } from "vitest";
import { primarySector } from "@/lib/universe/sectors";

describe("primarySector", () => {
  it("picks by priority", () => expect(primarySector(["NIFTY_FIN", "NIFTY_BANK"])).toBe("NIFTY_BANK"));
  it("single", () => expect(primarySector(["NIFTY_MEDIA"])).toBe("NIFTY_MEDIA"));
  it("empty", () => expect(primarySector([])).toBeNull());
  it("non-sector", () => expect(primarySector(["NIFTY200"])).toBeNull());
});
