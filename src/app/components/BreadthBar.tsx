/** Advance / unchanged / decline bar with counts and the A/D ratio; shared by the dashboard and Market tab. */
export function BreadthBar({
  breadth: b,
}: {
  breadth: { advances: number; declines: number; unchanged: number; total: number };
}) {
  const w = (n: number) => `${b.total > 0 ? (n / b.total) * 100 : 0}%`;
  return (
    <div className="flex flex-col gap-2">
      <div
        className="flex h-2 overflow-hidden rounded-full bg-[var(--panel-2)]"
        role="img"
        aria-label={`${b.advances} advances, ${b.unchanged} unchanged, ${b.declines} declines`}
      >
        <div style={{ width: w(b.advances), background: "var(--up)" }} />
        <div style={{ width: w(b.unchanged), background: "var(--muted)" }} />
        <div style={{ width: w(b.declines), background: "var(--down)" }} />
      </div>
      <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 font-mono text-xs tabular-nums">
        <span className="text-[var(--up)]">▲ {b.advances} advances</span>
        <span className="text-[var(--muted)]">{b.unchanged} unchanged</span>
        <span className="text-[var(--down)]">▼ {b.declines} declines</span>
        <span className="text-[var(--text)]">A/D {b.declines > 0 ? (b.advances / b.declines).toFixed(2) : "—"}</span>
      </div>
    </div>
  );
}
