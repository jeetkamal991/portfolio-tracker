"use client";

import { useState } from "react";

/** Long text cut at `limit` characters (at a word boundary) with a Read more / Read less toggle; short text is shown as is. */
export function ClampText({ text, limit = 150, className = "" }: { text: string; limit?: number; className?: string }) {
  const [open, setOpen] = useState(false);
  if (text.length <= limit + 20) return <p className={className}>{text}</p>;
  const cut = text.slice(0, limit).replace(/\s+\S*$/, "");
  return (
    <p className={className}>
      {open ? text : `${cut}…`}{" "}
      <button type="button" onClick={() => setOpen((v) => !v)} className="font-mono text-xs text-[var(--up)] hover:underline">
        {open ? "Read less" : "Read more"}
      </button>
    </p>
  );
}
