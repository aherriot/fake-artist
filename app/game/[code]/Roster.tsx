"use client";

import { useState } from "react";
import { clsx } from "clsx";
import type { useGameSync } from "@/lib/useGameSync";
import { Plaque, penVar } from "@/lib/ui/primitives";
import { useAction } from "@/lib/ui/useAction";
import { hasVoted } from "@/lib/game/optimistic";

/**
 * The players — and, while the ballot is open, the ballot itself.
 *
 * These used to be two lists of the same people: a roster in the sidebar and a
 * row of vote buttons under the canvas. On a phone they ended up screens
 * apart, and you had to match names between them. Voting from the roster keeps
 * the choice next to the seat colour and the isolate control, which is exactly
 * the evidence you are voting on.
 */
export function Roster({
  game,
  drawer,
  onHighlight,
  highlight,
}: {
  game: ReturnType<typeof useGameSync>;
  drawer: string | null;
  onHighlight: (id: string | null) => void;
  highlight: string | null;
}) {
  const { sync } = game;
  const { state } = sync;
  const [pendingId, setPendingId] = useState<string | null>(null);
  const cast = useAction(async (id: string) => game.castVote(id));

  const balloting = state.phase === "voting" || state.phase === "runoff";
  const voted = hasVoted(state, sync.pending, sync.you);
  const revealing = state.phase === "reveal" || state.phase === "complete";
  const result = revealing ? state.results[state.results.length - 1] : null;

  /** Votes received, from the round just revealed. */
  const tally = new Map<string, number>();
  if (result) {
    for (const target of Object.values(result.votes)) {
      tally.set(target, (tally.get(target) ?? 0) + 1);
    }
  }
  const yourVote = result && sync.you ? result.votes[sync.you] : undefined;

  const candidates =
    state.phase === "runoff" && state.runoffCandidates.length > 0
      ? state.runoffCandidates
      : sync.players.map((p) => p.id);

  const canVoteFor = (id: string) =>
    balloting && !voted && !cast.pending && id !== sync.you && candidates.includes(id);

  return (
    <Plaque>
      <p className="label-caps mb-3">
        {balloting
          ? voted
            ? "Your vote is in"
            : "Who is the fake artist?"
          : `${sync.players.length} hands`}
      </p>

      {balloting && !voted && (
        <p className="mb-3 text-sm text-label-500">
          Tap whoever drew like they were guessing. Not yourself.
        </p>
      )}

      <ul className="space-y-1">
        {sync.players.map((p) => {
          const online = sync.online.has(p.id);
          const votable = canVoteFor(p.id);
          const isFake = result?.fakeArtistId === p.id;
          const votes = tally.get(p.id) ?? 0;
          const dimmed = balloting && !voted && !votable;

          const row = (
            <>
              <span
                aria-hidden
                className="grid size-6 shrink-0 place-items-center rounded-[2px] font-mono text-[11px] text-wall-950"
                style={{ background: penVar(p.seat + 1) }}
              >
                {p.seat + 1}
              </span>
              <span className={clsx("truncate", online ? "text-label-100" : "text-label-700")}>
                {p.nickname}
              </span>

              <span className="ml-auto flex shrink-0 items-center gap-2 text-[11px]">
                {/* Vote counts, once the ballot is public. */}
                {result && votes > 0 && (
                  <span
                    className={clsx(
                      "rounded-full px-2 py-0.5 font-medium",
                      isFake ? "bg-accent-500/20 text-accent-400" : "bg-wall-600 text-label-300",
                    )}
                    title={`${votes} vote${votes === 1 ? "" : "s"}`}
                  >
                    {votes} {votes === 1 ? "vote" : "votes"}
                  </span>
                )}
                {isFake && <span className="label-caps text-accent-400">Fake</span>}
                {yourVote === p.id && <span className="label-caps">Your vote</span>}
                {!revealing && state.scores[p.id] > 0 && (
                  <span className="catalogue-no">{state.scores[p.id]}</span>
                )}
                {p.id === sync.hostId && !revealing && <span className="label-caps">Host</span>}
                {p.id === sync.you && <span className="label-caps">You</span>}
                {p.id === drawer && <span className="label-caps text-accent-400">Drawing</span>}
                {balloting && state.voted.includes(p.id) && (
                  <span className="label-caps text-success">Voted</span>
                )}
                {!online && !revealing && <span className="label-caps text-label-700">Away</span>}
              </span>
            </>
          );

          const common =
            "flex w-full items-center gap-2 rounded-sm px-2 py-2 text-left text-sm outline-none transition-colors";

          return (
            <li key={p.id}>
              {votable ? (
                <button
                  onClick={async () => {
                    setPendingId(p.id);
                    await cast.run(p.id);
                    setPendingId(null);
                  }}
                  onMouseEnter={() => onHighlight(p.id)}
                  onMouseLeave={() => onHighlight(null)}
                  className={clsx(
                    common,
                    "border border-wall-500 bg-wall-900 hover:border-accent-500",
                    pendingId === p.id && "border-accent-500 opacity-60",
                  )}
                >
                  {row}
                </button>
              ) : (
                <div
                  onMouseEnter={() => onHighlight(p.id)}
                  onMouseLeave={() => onHighlight(null)}
                  onClick={() => onHighlight(highlight === p.id ? null : p.id)}
                  className={clsx(
                    common,
                    "cursor-default border border-transparent",
                    highlight === p.id && "bg-wall-600",
                    p.id === drawer && "ring-1 ring-accent-500/40",
                    dimmed && "opacity-40",
                  )}
                >
                  {row}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {cast.error && <p role="alert" className="mt-3 text-sm text-danger">{cast.error}</p>}

      {balloting && (
        <p className="mt-3 text-xs text-label-500">
          {state.voted.length} of {sync.players.length} voted — all revealed together
        </p>
      )}
      {!balloting && !revealing && state.phase !== "lobby" && (
        <p className="mt-3 text-xs text-label-500">Tap a name to isolate their lines</p>
      )}
    </Plaque>
  );
}
