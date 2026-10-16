"use client";

import { useActionState } from "react";
import { signIn, type LoginState } from "./actions";

const initial: LoginState = { error: null };

export default function LoginPage() {
  const [state, action, pending] = useActionState(signIn, initial);
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <form action={action} className="flex w-full max-w-sm flex-col gap-3">
        <h1 className="text-xl font-semibold">Sign in</h1>
        <input name="email" type="email" required autoComplete="email" placeholder="Email" className="rounded border px-3 py-2 text-black" />
        <input name="password" type="password" required autoComplete="current-password" placeholder="Password" className="rounded border px-3 py-2 text-black" />
        {state.error && <p role="alert" className="text-sm text-red-600">{state.error}</p>}
        <button type="submit" disabled={pending} className="rounded bg-black px-3 py-2 text-white disabled:opacity-50">
          {pending ? "Signing in..." : "Sign in"}
        </button>
      </form>
    </main>
  );
}
