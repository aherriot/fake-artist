"use client";

import { useServerUnreachable } from "./connection";

/**
 * A persistent bar when the server cannot be reached.
 *
 * Without it a dead server is indistinguishable from an app that has simply
 * stopped responding: buttons do nothing, nothing changes, and there is no
 * explanation anywhere. Reassurance about the game state matters as much as
 * the diagnosis -- nothing is lost, because nothing lives in the tab.
 */
export function ConnectionBanner() {
  const down = useServerUnreachable();
  if (!down) return null;
  return (
    <div
      role="status"
      className="sticky top-0 z-40 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-danger/40 bg-danger/15 px-4 py-2 text-center text-sm text-danger backdrop-blur"
    >
      <span>
        <span aria-hidden>●</span> Can&apos;t reach the server.
      </span>
      <span className="text-label-300">
        Your game is safe — it lives on the server, not in this tab. Retrying automatically.
      </span>
      <button
        onClick={() => window.location.reload()}
        className="underline underline-offset-2 hover:text-label-100"
      >
        Reload
      </button>
    </div>
  );
}
