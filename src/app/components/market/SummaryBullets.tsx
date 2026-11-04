import { highlightParts, summaryBullets } from "@/lib/content/claude";

const TONE = { up: "text-[var(--up)]", down: "text-[var(--down)]", plain: "text-[var(--text)]" } as const;

/** A summary as short points, with the figures picked out in mono so they can be scanned. */
export function SummaryBullets({ text, max = 5 }: { text: string; max?: number }) {
  const bullets = summaryBullets(text, max);
  if (bullets.length === 0) return null;
  return (
    <ul className="flex flex-col gap-2.5">
      {bullets.map((b, i) => (
        <li key={i} className="flex gap-2.5 text-[15px] leading-relaxed text-[var(--muted)]">
          <i className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]" aria-hidden="true" />
          <span className="min-w-0">
            {highlightParts(b).map((p, k) =>
              p.tone ? (
                <b key={k} className={`font-mono text-[0.93em] font-semibold tabular-nums ${TONE[p.tone]}`}>
                  {p.text}
                </b>
              ) : (
                <span key={k}>{p.text}</span>
              ),
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}
