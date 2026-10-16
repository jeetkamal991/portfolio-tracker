/** Keep one row per key; the last occurrence wins (position of first occurrence is kept).
 *  Postgres rejects ON CONFLICT batches that touch the same row twice. */
export function dedupeLastWins<T>(rows: T[], keyOf: (r: T) => string): T[] {
  const m = new Map<string, T>();
  for (const r of rows) m.set(keyOf(r), r);
  return [...m.values()];
}
