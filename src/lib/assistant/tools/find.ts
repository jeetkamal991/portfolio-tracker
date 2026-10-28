import type { Repo } from "@/lib/db/repo";

export async function findTool(repo: Repo, args: string[]): Promise<string> {
  const q = args.join(" ").trim();
  if (!q) return "Usage: find <text>";
  const hits = await repo.searchInstruments(q, 10, { includeIndices: true });
  if (hits.length === 0) return `No instruments match "${q}".`;
  return ["KEY | NAME | TYPE", ...hits.map((h) => `${h.key} | ${h.name} | ${h.type}`)].join("\n");
}
