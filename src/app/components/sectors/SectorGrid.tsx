"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { fmtPct, heatColor, pctTone } from "@/lib/view/dashboard";
import { bigTileKeys, type ConstituentRow, type SectorTile } from "@/lib/view/sectors";
import { Label } from "../ui";
import { IMPORT_MESSAGE } from "./ConstituentTable";
import { SectorScore } from "./SectorScore";

const PREVIEW_W = 256; // px, matches w-64

/**
 * Sector tiles linking to `?s=KEY`. On hover-capable devices, hover or keyboard focus shows a
 * preview of the sector's top 3 gainers and losers; touch devices skip it (a tap selects).
 */
export function SectorGrid({ tiles, selected }: { tiles: SectorTile[]; selected: string | null }) {
  const [canHover, setCanHover] = useState(false);
  const [preview, setPreview] = useState<{ key: string; alignRight: boolean } | null>(null);
  const bigKeys = bigTileKeys(tiles);

  useEffect(() => {
    const mq = window.matchMedia("(hover: hover)");
    setCanHover(mq.matches);
    const onChange = () => setCanHover(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const show = (key: string, el: HTMLElement) => {
    if (!canHover) return;
    // Anchor to the tile's right edge when a left-anchored card would run off the viewport.
    const r = el.getBoundingClientRect();
    setPreview({ key, alignRight: r.left + PREVIEW_W > window.innerWidth - 16 });
  };
  const hide = (key: string) => setPreview((p) => (p?.key === key ? null : p));

  return (
    <div className="grid auto-rows-[112px] grid-flow-dense grid-cols-3 gap-3 lg:grid-cols-4 xl:grid-cols-6">
      {tiles.map((t) => {
        const big = bigKeys.has(t.key);
        const arrow = t.d1 === null || t.d1 === 0 ? "" : t.d1 > 0 ? "▲ " : "▼ ";
        const open = preview?.key === t.key;
        return (
          <div key={t.key} className={`relative ${big ? "col-span-2 row-span-2" : ""}`} onMouseEnter={(e) => show(t.key, e.currentTarget)} onMouseLeave={() => hide(t.key)}>
            <Link
              href={`/sectors?s=${encodeURIComponent(t.key)}`}
              scroll={false}
              aria-current={t.key === selected ? "true" : undefined}
              onFocus={(e) => show(t.key, e.currentTarget)}
              onBlur={() => hide(t.key)}
              className={`flex h-full flex-col gap-2 rounded-lg border border-[var(--border)] p-3 transition hover:brightness-125 ${
                t.key === selected ? "ring-1 ring-[var(--up)]" : ""
              }`}
              style={{ backgroundColor: heatColor(t.d1, "d1") }}
            >
              <span className="truncate text-sm font-semibold text-[var(--text)]">{t.name.replace(/^Nifty /, "")}</span>
              <span className={`font-mono font-semibold tabular-nums ${big ? "text-4xl" : "text-xl"} ${pctTone(t.d1)}`}>
                {arrow}
                {fmtPct(t.d1)}
              </span>
              <span className="flex flex-wrap items-center gap-2">
                {t.scoreLabel ? <SectorScore tile={t} /> : null}
                <span className="font-mono text-xs tabular-nums text-[var(--muted)]">RSI {t.rsi === null ? "—" : t.rsi.toFixed(1)}</span>
              </span>
            </Link>
            {open && <Preview tile={t} alignRight={preview.alignRight} />}
          </div>
        );
      })}
    </div>
  );
}

function Preview({ tile, alignRight }: { tile: SectorTile; alignRight: boolean }) {
  return (
    <div
      role="tooltip"
      className={`absolute top-full z-30 mt-2 w-64 rounded-lg border border-[var(--border)] bg-[var(--panel)] p-3 shadow-xl ${
        alignRight ? "right-0" : "left-0"
      }`}
    >
      {tile.constituentCount === 0 ? (
        <p className="text-xs text-[var(--muted)]">{IMPORT_MESSAGE}</p>
      ) : (
        <div className="flex flex-col gap-3">
          <PreviewList title="TOP GAINERS" rows={tile.topGainers} />
          <PreviewList title="TOP LOSERS" rows={tile.topLosers} />
        </div>
      )}
    </div>
  );
}

function PreviewList({ title, rows }: { title: string; rows: ConstituentRow[] }) {
  return (
    <div className="flex flex-col gap-1">
      <Label>{title}</Label>
      {rows.length === 0 ? (
        <span className="text-xs text-[var(--muted)]">None today.</span>
      ) : (
        rows.map((r) => (
          <div key={r.key} className="flex items-baseline justify-between gap-3 text-sm">
            <span className="truncate">{r.name}</span>
            <span className={`font-mono tabular-nums ${pctTone(r.dayPct)}`}>{fmtPct(r.dayPct)}</span>
          </div>
        ))
      )}
    </div>
  );
}
