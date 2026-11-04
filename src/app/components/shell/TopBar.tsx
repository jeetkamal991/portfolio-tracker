"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "@/app/login/actions";
import { activeTab, TABS } from "@/lib/view/shell";
import { Bell } from "../alerts/Bell";
import { SearchBox } from "./SearchBox";

function Tabs({ className }: { className: string }) {
  const active = activeTab(usePathname() ?? "/");
  return (
    <nav aria-label="Sections" className={className}>
      {TABS.map((t) => {
        const on = t.href === active;
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={on ? "page" : undefined}
            className={`whitespace-nowrap rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
              on
                ? "border-[var(--border)] bg-slate-800 text-[var(--up)]"
                : "border-transparent text-[var(--muted)] hover:bg-slate-800/50 hover:text-[var(--text)]"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function TopBar() {
  return (
    <header className="sticky top-0 z-30 border-b border-[var(--border)] bg-[var(--panel)]">
      <div className="mx-auto flex h-14 max-w-[1366px] items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" className="flex items-baseline gap-2">
          <span className="text-lg font-extrabold tracking-tight">
            NIFTY<span className="text-[var(--up)]">PULSE</span>
          </span>
          <span className="hidden font-mono text-[10px] uppercase tracking-wider text-[var(--muted)] sm:inline">
            NSE TERMINAL
          </span>
        </Link>
        <Tabs className="hidden items-center gap-1 lg:flex" />
        <div className="flex items-center gap-3">
          <SearchBox />
          <Bell />
          <form action={signOut}>
            <button type="submit" className="whitespace-nowrap text-sm text-[var(--muted)] hover:text-[var(--text)]">
              Sign out
            </button>
          </form>
        </div>
      </div>
      <Tabs className="flex gap-1 overflow-x-auto border-t border-[var(--border)] px-4 py-2 lg:hidden" />
    </header>
  );
}
