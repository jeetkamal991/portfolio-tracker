export interface QuotesPollerOpts {
  fetchQuotes: () => Promise<void>;
  isOpen: () => boolean;
  onClosed: () => void;
  intervalMs: number;
}

/**
 * Fetch once immediately, whatever the market hours (so a page opened after 15:30 IST shows
 * today's close rather than yesterday's stored one; the route is cached ~60 s), then every
 * `intervalMs` fetch only while the market is open, calling `onClosed` on ticks when it is not.
 * Returns a stop function.
 */
export function startQuotesPoller({ fetchQuotes, isOpen, onClosed, intervalMs }: QuotesPollerOpts): () => void {
  void fetchQuotes();
  const timer = setInterval(() => {
    if (isOpen()) void fetchQuotes();
    else onClosed();
  }, intervalMs);
  return () => clearInterval(timer);
}
