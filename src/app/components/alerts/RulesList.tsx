"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { AlertRule } from "@/lib/db/types";
import { lastFiredText, ruleText } from "@/lib/view/alerts";
import { StockLink } from "../popup/StockLink";
import { Chip, Panel } from "../ui";

function RuleRow({ rule }: { rule: AlertRule }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const user = rule.source === "user";

  async function call(method: "PATCH" | "DELETE", body?: unknown) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/alerts/${rule.id}`, {
        method,
        ...(body !== undefined && { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
      });
      if (!res.ok) throw new Error();
      router.refresh();
    } catch {
      setError(method === "DELETE" ? "Could not delete" : "Could not update");
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <li className={`flex flex-col gap-1 border-t border-[var(--border)] py-3 first:border-t-0 ${rule.active ? "" : "opacity-60"}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <StockLink stockKey={rule.key} className="font-mono font-semibold">{rule.key}</StockLink>
          <span>{ruleText(rule)}</span>
          <Chip tone="neutral">{rule.mode === "once" ? "Once" : "Every time"}</Chip>
          {!rule.active && <Chip tone="warn">Paused</Chip>}
        </div>
        {user ? (
          <div className="flex items-center gap-3 text-xs">
            <button
              type="button"
              disabled={busy}
              onClick={() => void call("PATCH", { active: !rule.active })}
              className="text-[var(--muted)] hover:text-[var(--text)] disabled:opacity-50"
            >
              {rule.active ? "Pause" : "Resume"}
            </button>
            {confirming ? (
              <>
                <button type="button" disabled={busy} onClick={() => void call("DELETE")} className="font-medium text-[var(--down)] disabled:opacity-50">
                  Confirm delete
                </button>
                <button type="button" onClick={() => setConfirming(false)} className="text-[var(--muted)] hover:text-[var(--text)]">
                  Cancel
                </button>
              </>
            ) : (
              <button type="button" disabled={busy} onClick={() => setConfirming(true)} className="text-[var(--muted)] hover:text-[var(--down)] disabled:opacity-50">
                Delete
              </button>
            )}
          </div>
        ) : (
          <Link href={`/portfolio?edit=${encodeURIComponent(rule.key)}`} className="text-xs text-[var(--muted)] hover:text-[var(--up)]">
            Edit in Portfolio
          </Link>
        )}
      </div>
      <p className="font-mono text-[11px] text-[var(--muted)]">{lastFiredText(rule.lastFiredAt)}</p>
      {error && <p role="alert" className="text-xs text-[var(--down)]">{error}</p>}
    </li>
  );
}

function Group({ title, rules, empty }: { title: string; rules: AlertRule[]; empty: string }) {
  return (
    <div>
      <h3 className="mb-1 text-sm font-semibold">{title}</h3>
      {rules.length === 0 ? (
        <p className="py-2 text-sm text-[var(--muted)]">{empty}</p>
      ) : (
        <ul>{rules.map((r) => <RuleRow key={r.id} rule={r} />)}</ul>
      )}
    </div>
  );
}

export function RulesList({ rules }: { rules: AlertRule[] }) {
  return (
    <Panel title="Alert rules">
      <div className="flex flex-col gap-5">
        <Group title="Your alerts" rules={rules.filter((r) => r.source === "user")} empty="No alerts yet — create one above." />
        <Group
          title="From your portfolio"
          rules={rules.filter((r) => r.source === "holding")}
          empty="Set a stop loss or target on a holding and its alerts appear here."
        />
      </div>
    </Panel>
  );
}
