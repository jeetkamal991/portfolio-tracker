const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Runs fn up to `attempts` times total, waiting baseMs * 2^(n-1) between tries. */
export async function withRetry<T>(
  fn: () => Promise<T>,
  attempts = 3,
  baseMs = 1000,
  sleep: (ms: number) => Promise<void> = realSleep,
): Promise<T> {
  let lastErr: unknown;
  for (let n = 1; n <= attempts; n++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (n < attempts) await sleep(baseMs * 2 ** (n - 1));
    }
  }
  throw lastErr;
}
