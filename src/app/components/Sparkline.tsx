/** Inline SVG trend line; green when the last value ≥ the first, red otherwise. Fewer than 2 values → "—". */
export function Sparkline({ values, width = 96, height = 28 }: { values: number[]; width?: number; height?: number }) {
  if (values.length < 2) {
    return (
      <span aria-label="1-month trend" className="inline-block text-center font-mono text-[var(--muted)]" style={{ width }}>
        —
      </span>
    );
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pad = 2;
  const x = (i: number) => pad + (i / (values.length - 1)) * (width - 2 * pad);
  const y = (v: number) => pad + (1 - (v - min) / span) * (height - 2 * pad);
  const points = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const colour = values[values.length - 1]! >= values[0]! ? "var(--up)" : "var(--down)";
  const lastX = x(values.length - 1);
  const lastY = y(values[values.length - 1]!);
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="1-month trend" className="block">
      <polygon points={`${x(0).toFixed(1)},${height} ${points} ${lastX.toFixed(1)},${height}`} fill={colour} fillOpacity={0.12} />
      <polyline points={points} fill="none" stroke={colour} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={lastX} cy={lastY} r={2} fill={colour} />
    </svg>
  );
}
