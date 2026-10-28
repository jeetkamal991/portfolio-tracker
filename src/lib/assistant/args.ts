const TRACKER = "Bash(npm run tracker -- ";
export const ALLOWED_BASH = [
  `${TRACKER}find *)`,
  `${TRACKER}stock *)`,
  `${TRACKER}screeners*)`,
  `${TRACKER}alphas*)`,
  `${TRACKER}market*)`,
  "Bash(npm run backtest *)",
];
export const HOLDINGS_BASH = `${TRACKER}portfolio*)`;

export interface RunOptions {
  message: string;
  holdings: boolean;
  model?: string;
  resume?: string;
  maxUsd?: number;
}

/** CLI arguments for one run. Holdings and web tools are mutually exclusive: only `holdings` decides. */
export function buildArgs(o: RunOptions): string[] {
  const tools = o.holdings ? "Bash" : "Bash,WebSearch,WebFetch";
  const allowed = o.holdings ? [...ALLOWED_BASH, HOLDINGS_BASH] : [...ALLOWED_BASH, "WebSearch", "WebFetch"];
  return [
    "-p", o.message,
    "--output-format", "stream-json", "--verbose", "--include-partial-messages",
    "--setting-sources", "project",
    "--permission-mode", "dontAsk",
    "--disable-slash-commands",
    "--max-budget-usd", String(o.maxUsd ?? 1),
    "--tools", tools,
    "--allowedTools", allowed.join(","),
    ...(o.model ? ["--model", o.model] : []),
    ...(o.resume ? ["--resume", o.resume] : []),
  ];
}
