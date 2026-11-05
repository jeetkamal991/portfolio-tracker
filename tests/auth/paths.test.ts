import { describe, expect, it } from "vitest";
import { isApiPath, isPublicPath } from "@/lib/auth/paths";

describe("isPublicPath", () => {
  it("allows login and cron", () => {
    expect(isPublicPath("/login")).toBe(true);
    expect(isPublicPath("/api/cron/eod")).toBe(true);
    expect(isPublicPath("/api/cron")).toBe(true);
  });
  it("keeps the new evaluation API and rankings page behind login, and the snapshot cron on the secret", () => {
    expect(isPublicPath("/api/evaluation/TRENT")).toBe(false);
    expect(isPublicPath("/rankings")).toBe(false);
    expect(isPublicPath("/api/cron/snapshots")).toBe(true);
  });
  it("protects everything else with exact segment matching", () => {
    expect(isPublicPath("/")).toBe(false);
    expect(isPublicPath("/api/quotes")).toBe(false);
    expect(isPublicPath("/loginx")).toBe(false);
    expect(isPublicPath("/api/cronx")).toBe(false);
  });
});

describe("isApiPath", () => {
  it("detects api routes", () => {
    expect(isApiPath("/api/quotes")).toBe(true);
    expect(isApiPath("/api")).toBe(true);
    expect(isApiPath("/")).toBe(false);
    expect(isApiPath("/apix")).toBe(false);
  });
});
