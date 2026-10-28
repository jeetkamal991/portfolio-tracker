import type { Repo } from "@/lib/db/repo";
import { alphasTool } from "./alphas";
import { findTool } from "./find";
import { marketTool } from "./market";
import { portfolioTool } from "./portfolio";
import { screenersTool } from "./screeners";
import { stockTool } from "./stock";

export const TOOL_CAP = 6000;

const TOOLS: Record<string, (repo: Repo, args: string[]) => Promise<string>> = {
  find: findTool, stock: stockTool, screeners: screenersTool, alphas: alphasTool, market: marketTool, portfolio: portfolioTool,
};

/** Runs one tracker tool and keeps its output small enough for the assistant's context. */
export async function runTool(repo: Repo, name: string, args: string[]): Promise<string> {
  const tool = TOOLS[name];
  if (!tool) throw new Error(`Unknown tool "${name}". Tools: ${Object.keys(TOOLS).join(", ")}`);
  const out = await tool(repo, args);
  return out.length > TOOL_CAP ? `${out.slice(0, TOOL_CAP)}\n… (cut at ${TOOL_CAP} characters)` : out;
}
