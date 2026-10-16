import { describe, expect, it } from "vitest";
import { config } from "@/middleware";

const re = new RegExp("^" + config.matcher[0] + "$");

describe("middleware matcher", () => {
  it.each(["/api/logosvg", "/api/export/png", "/api/x.png", "/faviconXico/a", "/", "/api/quotes"])(
    "runs middleware for %s",
    (p) => expect(re.test(p)).toBe(true),
  );
  it.each(["/_next/static/chunk.js", "/_next/image", "/favicon.ico", "/logo.svg"])(
    "skips %s",
    (p) => expect(re.test(p)).toBe(false),
  );
});
