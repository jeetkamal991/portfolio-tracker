import type { Repo } from "@/lib/db/repo";

export async function handleSearch(repo: Repo, q: string | null): Promise<{ key: string; name: string }[]> {
  const term = (q ?? "").trim();
  if (term.length < 2) return [];
  return (await repo.searchInstruments(term, 10)).map(({ key, name }) => ({ key, name }));
}
