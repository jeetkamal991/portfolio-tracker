import { spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { buildArgs } from "@/lib/assistant/args";
import { cliEnv, resolveClaudeBin } from "@/lib/assistant/runner";

/* eslint-disable @typescript-eslint/no-explicit-any */
// Proves the CLI guarantees the assistant relies on, against the real CLI on this PC. Costs a few cents. Run by hand.
const cwd = resolve(import.meta.dirname, "..", "assistant");
const bin = resolveClaudeBin(process.env);
let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : detail ? `  (${detail})` : ""}`);
};

function run(message: string, holdings = false) {
  const r = spawnSync(bin, buildArgs({ message, holdings, maxUsd: 0.5 }), {
    cwd, encoding: "utf8", timeout: 240_000, env: cliEnv(process.env) as NodeJS.ProcessEnv,
  });
  const msgs = (r.stdout ?? "").split("\n").flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
  const init = msgs.find((m: any) => m.type === "system" && m.subtype === "init");
  const result = msgs.find((m: any) => m.type === "result");
  const results = msgs.flatMap((m: any) => (m.type === "user" ? m.message?.content ?? [] : [])).filter((b: any) => b.type === "tool_result");
  return { init, result, results, stderr: r.stderr ?? "", status: r.status };
}

const e = run("- Say the single word ok.");
check("a message starting with a dash is read as the prompt", !!e.result && !e.result.is_error && /ok/i.test(String(e.result.result)), e.stderr.trim().slice(0, 200) || String(e.result?.result).slice(0, 100));

const probe = join(cwd, "should-not-exist.txt");
rmSync(probe, { force: true });

const a = run("Run exactly this command and nothing else: npm run tracker -- find RELI. Then reply with the first key in the output.");
check("CLI starts and logs in", !!a.init && !!a.result, a.stderr.trim().slice(0, 200));
check("a listed command runs from assistant/", a.results.length > 0 && a.results.every((r: any) => !r.is_error) && JSON.stringify(a.results).includes("RELIANCE"), JSON.stringify(a.results).slice(0, 200));
check("research mode exposes only Bash, WebSearch, WebFetch", JSON.stringify([...(a.init?.tools ?? [])].sort()) === JSON.stringify(["Bash", "WebFetch", "WebSearch"]), JSON.stringify(a.init?.tools));
const skills = [...(a.init?.slash_commands ?? []), ...(a.init?.skills ?? [])];
check("no skills or slash commands load", skills.length === 0, skills.slice(0, 5).join(", "));

const b = run(`Run exactly this command: node -e "require('fs').writeFileSync('should-not-exist.txt','x')". Report what happened.`);
check("an unlisted file write is refused", !existsSync(probe) && (b.result?.permission_denials?.length ?? 0) > 0, `file exists: ${existsSync(probe)}, denials: ${b.result?.permission_denials?.length}`);
rmSync(probe, { force: true });

const c = run("Say hi.", true);
check("holdings mode exposes only Bash", JSON.stringify(c.init?.tools) === JSON.stringify(["Bash"]), JSON.stringify(c.init?.tools));

const d = run("Does a CLAUDE.md or any project instructions file other than yours exist in your context? Name the title of every instruction file you can see.");
check("only assistant/CLAUDE.md is in context", /research assistant/i.test(JSON.stringify(d.result?.result ?? "")) && !/ponytail|superpowers|vercel/i.test(JSON.stringify(d.result?.result ?? "")), String(d.result?.result).slice(0, 200));

console.log(failed ? `\n${failed} check(s) failed.` : "\nAll checks passed.");
process.exit(failed ? 1 : 0);
