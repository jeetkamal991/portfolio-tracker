import { fmtPct, pctTone } from "@/lib/view/dashboard";
import { sectorMood, type Mood, type SectorTile } from "@/lib/view/sectors";
import { Chip, Label, type Tone } from "../ui";

const MOOD: Record<Mood, { label: string; tone: Tone; glow: string }> = {
  RISK_ON: { label: "RISK-ON", tone: "up", glow: "rgba(52,211,153,0.16)" },
  MIXED: { label: "MIXED", tone: "warn", glow: "rgba(251,191,36,0.10)" },
  RISK_OFF: { label: "RISK-OFF", tone: "down", glow: "rgba(251,113,133,0.16)" },
};

export function SectorMood({ tiles, nifty }: { tiles: SectorTile[]; nifty: { close: number | null; dayPct: number | null } }) {
  const s = sectorMood(tiles);
  const m = s.mood ? MOOD[s.mood] : null;
  return (
    <div
      className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-6"
      style={m ? { backgroundImage: `radial-gradient(800px 260px at 90% -30%, ${m.glow}, transparent 60%)` } : undefined}
    >
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <div>
          <Label>Nifty 50 · close</Label>
          <div className="font-mono text-5xl font-semibold leading-none tracking-tighter tabular-nums sm:text-7xl">
            {nifty.close === null ? "—" : nifty.close.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
          </div>
          <div className={`mt-2 font-mono text-lg tabular-nums ${pctTone(nifty.dayPct)}`}>{fmtPct(nifty.dayPct)}</div>
        </div>
        <div className="max-w-[38ch] sm:text-right">
          {m && <Chip tone={m.tone}>{m.label}</Chip>}
          <p className="mt-2 text-sm text-[var(--muted)]">
            {s.total === 0
              ? "No sector moves for this session yet."
              : `${s.up} of ${s.total} sectors green.${s.best ? ` ${s.best.name} leads at ${fmtPct(s.best.d1)}` : ""}${s.worst ? `, ${s.worst.name} lags at ${fmtPct(s.worst.d1)}` : ""}.`}
          </p>
        </div>
      </div>
    </div>
  );
}
