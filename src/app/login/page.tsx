"use client";

import { useActionState } from "react";
import { signIn, type LoginState } from "./actions";

const initial: LoginState = { error: null };

const field =
  "rounded-md border border-neutral-300 bg-white px-3 py-2 text-neutral-900 placeholder:text-neutral-400 " +
  "focus:border-neutral-500 focus:outline-none focus:ring-2 focus:ring-neutral-400/40 " +
  "dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 dark:placeholder:text-neutral-500";

export default function LoginPage() {
  const [state, action, pending] = useActionState(signIn, initial);
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <form
        action={action}
        className="flex w-full max-w-sm flex-col gap-4 rounded-lg border border-neutral-200 p-6 dark:border-neutral-800"
      >
        <h1 className="text-xl font-semibold">Sign in</h1>
        <label className="flex flex-col gap-1 text-sm">
          Email
          <input name="email" type="email" required autoComplete="email" className={field} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Password
          <input name="password" type="password" required autoComplete="current-password" className={field} />
        </label>
        {state.error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{state.error}</p>}
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-neutral-900 px-3 py-2 font-medium text-white hover:bg-neutral-700 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
        >
          {pending ? "Signing in..." : "Sign in"}
        </button>
      </form>
    </main>
  );
}
