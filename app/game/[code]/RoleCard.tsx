"use client";

import type { SyncState } from "@/lib/useGameSync";
import { Plaque } from "@/lib/ui/primitives";

/**
 * What only you know.
 *
 * Rendered from `privateState`, which the server returns for the requesting
 * player alone. The Fake Artist's card shows no topic because their row has
 * none -- the absence is real, not hidden by CSS.
 */
export function RoleCard({ sync }: { sync: SyncState }) {
  const priv = sync.privateState;
  if (!priv) return null;
  const fake = priv.role === "fake";

  return (
    <Plaque
      className={fake ? "border-accent-500/50" : undefined}
      >
      <p className="label-caps">{fake ? "You are the fake artist" : "You are a real artist"}</p>
      {fake ? (
        <>
          <p className="mt-2 font-display text-2xl text-accent-400">You don&apos;t know it</p>
          <p className="mt-2 text-sm text-label-300">
            Everyone else was told what this is. Draw as though you were too.
          </p>
          <p className="mt-3 text-xs text-label-500">
            The subject is{" "}
            <span className="text-label-300">{sync.state.category ?? "—"}</span>. That is all
            you get.
          </p>
        </>
      ) : (
        <>
          <p className="mt-2 font-display text-3xl">{priv.topic}</p>
          <p className="mt-2 text-sm text-label-300">
            Draw enough to prove you know it — but not enough for the fake artist to work
            it out.
          </p>
        </>
      )}
    </Plaque>
  );
}
