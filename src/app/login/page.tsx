"use client";

import { useActionState } from "react";
import { signIn, type LoginState } from "./actions";

const initial: LoginState = { error: null };

const field =
  "rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-3 py-2 text-[var(--text)] placeholder:text-[var(--muted)] " +
  "focus:border-[var(--up)] focus:outline-none focus:ring-2 focus:ring-[var(--up)]/30";

export default function LoginPage() {
  const [state, action, pending] = useActionState(signIn, initial);
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <form
        action={action}
        className="flex w-full max-w-sm flex-col gap-4 rounded-xl border border-[var(--border)] bg-[var(--panel)] p-6"
      >
        <h1 className="text-xl font-extrabold tracking-tight">
          NIFTY<span className="text-[var(--up)]">PULSE</span>
          <span className="ml-2 align-middle font-mono text-[10px] font-normal uppercase tracking-wider text-[var(--muted)]">Sign in</span>
        </h1>
        <label className="flex flex-col gap-1 font-mono text-[10px] uppercase tracking-wider text-[var(--muted)]">
          Email
          <input name="email" type="email" required autoComplete="email" className={field} />
        </label>
        <label className="flex flex-col gap-1 font-mono text-[10px] uppercase tracking-wider text-[var(--muted)]">
          Password
          <input name="password" type="password" required autoComplete="current-password" className={field} />
        </label>
        {state.error && <p role="alert" className="text-sm text-[var(--down)]">{state.error}</p>}
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-[var(--up)] px-3 py-2 font-semibold text-slate-950 hover:brightness-110 disabled:opacity-50"
        >
          {pending ? "Signing in..." : "Sign in"}
        </button>
      </form>
    </main>
  );
}
