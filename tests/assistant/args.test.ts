import { describe, expect, it } from "vitest";
import { buildArgs } from "@/lib/assistant/args";

const val = (a: string[], flag: string) => a[a.indexOf(flag) + 1];
const allowed = (a: string[]) => val(a, "--allowedTools").split(",");

describe("buildArgs", () => {
  it("research mode: web tools, every tracker/backtest command, no portfolio", () => {
    const a = buildArgs({ message: "hi", holdings: false });
    expect(val(a, "--tools")).toBe("Bash,WebSearch,WebFetch");
    expect(allowed(a)).toEqual([
      "Bash(npm run tracker -- find *)",
      "Bash(npm run tracker -- stock *)",
      "Bash(npm run tracker -- screeners*)",
      "Bash(npm run tracker -- alphas*)",
      "Bash(npm run tracker -- market*)",
      "Bash(npm run backtest *)",
      "WebSearch",
      "WebFetch",
    ]);
    expect(a.join(" ")).not.toContain("portfolio");
  });

  it("holdings mode: Bash only, portfolio allowed, no web tools", () => {
    const a = buildArgs({ message: "hi", holdings: true, model: "claude-opus-5-5" });
    expect(val(a, "--tools")).toBe("Bash");
    expect(allowed(a)).toContain("Bash(npm run tracker -- portfolio*)");
    expect(a.join(" ")).not.toMatch(/WebSearch|WebFetch/);
  });

  it("model and resume only when set; budget default 1", () => {
    const a = buildArgs({ message: "hi", holdings: false });
    expect(a).not.toContain("--model");
    expect(a).not.toContain("--resume");
    expect(val(a, "--max-budget-usd")).toBe("1");
    const b = buildArgs({ message: "hi", holdings: false, model: "m", resume: "s1", maxUsd: 2.5 });
    expect(val(b, "--model")).toBe("m");
    expect(val(b, "--resume")).toBe("s1");
    expect(val(b, "--max-budget-usd")).toBe("2.5");
  });

  it("keeps the message as one argv entry after -p, never --bare", () => {
    const msg = "a; rm -rf / $(x) --tools";
    const a = buildArgs({ message: msg, holdings: false });
    expect(a[a.indexOf("-p") + 1]).toBe(msg);
    expect(a.filter((x) => x === msg)).toHaveLength(1);
    expect(a).not.toContain("--bare");
    expect(a).toEqual(expect.arrayContaining(["--permission-mode", "dontAsk", "--disable-slash-commands", "--setting-sources", "project"]));
  });
});
