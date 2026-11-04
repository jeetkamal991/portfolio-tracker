import { scoreTone } from "@/lib/view/deepdive";

const TONE_VAR = { up: "var(--up)", warn: "var(--warn)", down: "var(--down)", muted: "var(--muted)" } as const;

/** The Technical Score as a ring (0 to 100) with the number inside; grey with a dash when there is no score yet. */
export function ScoreRing({ score, size = 62, caption = true }: { score: number | null; size?: number; caption?: boolean }) {
  const r = size / 2 - 5;
  const c = 2 * Math.PI * r;
  const color = TONE_VAR[scoreTone(score)];
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} title={score === null ? "No score yet" : "Technical Score today"}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--border)" strokeWidth="6" />
        {score !== null && (
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="6" strokeLinecap="round" strokeDasharray={`${((score / 100) * c).toFixed(1)} ${c.toFixed(1)}`} />
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center font-mono leading-none" style={{ color }}>
        <span className="text-lg font-semibold">{score ?? "—"}</span>
        {caption && <span className="mt-0.5 text-[8px] uppercase tracking-wider text-[var(--muted)]">score</span>}
      </div>
    </div>
  );
}
