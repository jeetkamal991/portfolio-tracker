import type { Repo } from "@/lib/db/repo";
import type { InstrumentType } from "@/lib/db/types";

export interface SearchHit { key: string; name: string; type: InstrumentType }

/** `scope: "all"` also returns indices and sectors (top-bar search); the default is stocks only. */
export async function handleSearch(repo: Repo, q: string | null, scope: string | null = null): Promise<SearchHit[]> {
  const term = (q ?? "").trim();
  if (term.length < 2) return [];
  const hits = await repo.searchInstruments(term, 10, { includeIndices: scope === "all" });
  return hits.map(({ key, name, type }) => ({ key, name, type }));
}
