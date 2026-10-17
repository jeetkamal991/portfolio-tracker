import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startQuotesPoller } from "@/lib/live/quotesPoller";

describe("startQuotesPoller", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const setup = (open: boolean) => {
    const state = { open };
    const fetchQuotes = vi.fn(async () => {});
    const onClosed = vi.fn();
    const stop = startQuotesPoller({ fetchQuotes, isOpen: () => state.open, onClosed, intervalMs: 60_000 });
    return { state, fetchQuotes, onClosed, stop };
  };

  it("fetches once on mount even when the market is closed (after 15:30 shows today's close)", () => {
    const { fetchQuotes, onClosed } = setup(false);
    expect(fetchQuotes).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(180_000);
    expect(fetchQuotes).toHaveBeenCalledTimes(1);
    expect(onClosed).toHaveBeenCalled();
  });

  it("fetches on mount and every 60 s while open", () => {
    const { fetchQuotes } = setup(true);
    expect(fetchQuotes).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(120_000);
    expect(fetchQuotes).toHaveBeenCalledTimes(3);
  });

  it("starts polling when the market opens and stops when it closes", () => {
    const { state, fetchQuotes } = setup(false);
    vi.advanceTimersByTime(60_000);
    expect(fetchQuotes).toHaveBeenCalledTimes(1);
    state.open = true;
    vi.advanceTimersByTime(60_000);
    expect(fetchQuotes).toHaveBeenCalledTimes(2);
    state.open = false;
    vi.advanceTimersByTime(60_000);
    expect(fetchQuotes).toHaveBeenCalledTimes(2);
  });

  it("stop() cancels further polls", () => {
    const { fetchQuotes, stop } = setup(true);
    stop();
    vi.advanceTimersByTime(300_000);
    expect(fetchQuotes).toHaveBeenCalledTimes(1);
  });
});
