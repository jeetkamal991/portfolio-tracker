/**
 * True when the provider says the symbol itself has no data (Yahoo answers an unknown or delisted
 * ticker with a 404 whose description is "No data found, symbol may be delisted"), as opposed to a
 * transient network or rate-limit error that is worth retrying tomorrow.
 */
export function isUnknownSymbolError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /no data found|symbol may be delisted/i.test(msg);
}
