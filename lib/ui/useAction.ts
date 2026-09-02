"use client";

import { useCallback, useState } from "react";

/**
 * Wraps an action so every button can show that it is working and say when it
 * failed.
 *
 * The convention: the wrapped function resolves to an error string, or to
 * null/undefined on success. That matches what the mutations in useGameSync
 * already return, so nothing has to throw to report a normal failure.
 */
export function useAction<A extends unknown[]>(
  fn: (...args: A) => Promise<string | null | void>,
) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (...args: A) => {
      setPending(true);
      setError(null);
      try {
        const err = await fn(...args);
        if (typeof err === "string" && err) setError(err);
        return err ?? null;
      } catch (e) {
        // A thrown error is a bug rather than a normal failure, but the user
        // still needs to see something other than a button that did nothing.
        setError(e instanceof Error ? e.message : "Something went wrong.");
        return null;
      } finally {
        setPending(false);
      }
    },
    [fn],
  );

  return { run, pending, error, clear: useCallback(() => setError(null), []) };
}
