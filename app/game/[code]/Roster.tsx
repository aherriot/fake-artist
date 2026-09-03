"use client";

import { useState } from "react";
import { clsx } from "clsx";
import type { useGameSync } from "@/lib/useGameSync";
import { Plaque, penTextVar } from "@/lib/ui/primitives";
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
  isHost,
}: {
  game: ReturnType<typeof useGameSync>;
  drawer: string | null;
  onHighlight: (id: string | null) => void;
  highlight: string | null;
  isHost: boolean;
}) {
  const { sync } = game;
  const { state } = sync;
  const [pendingId, setPendingId] = useState<string | null>(null);
  const cast = useAction(async (id: string) => game.castVote(id));
  const drop = useAction(async (id: string) => game.dropPlayer(id));

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

  const yourPick = sync.pending.votedFor ?? sync.privateState?.vote ?? null;
  // Voting stays open to changes: nothing is revealed until every vote is in,
  // so a misclick should never decide the round.
  const canVoteFor = (id: string) =>
    balloting && !cast.pending && id !== sync.you && candidates.includes(id);

  return (
    <Plaque>
      <p className="label-caps mb-3">
        {balloting ? "Who is the fake artist?" : `${sync.players.length} hands`}
      </p>

      {balloting && (
        <p className="mb-3 text-sm text-label-500">
          {voted
            ? "Tap someone else to change your vote — nothing is revealed until everyone has voted."
            : "Tap whoever drew like they were guessing. Not yourself."}
        </p>
      )}

      <ul className="space-y-1">
        {sync.players.map((p) => {
          const online = sync.online.has(p.id);
          const votable = canVoteFor(p.id);
          const picked = balloting && yourPick === p.id;
          const isFake = result?.fakeArtistId === p.id;
          const votes = tally.get(p.id) ?? 0;
          const dimmed = balloting && !votable && !picked;

          const row = (
            <>
              <span
                aria-hidden
                className="grid size-6 shrink-0 place-items-center rounded-[2px] font-mono text-[11px] text-wall-950"
                style={{ background: penTextVar(p.seat + 1) }}
              >
                {p.seat + 1}
              </span>
              <span
                className={clsx("truncate font-medium", !online && "opacity-50")}
                style={{ color: penTextVar(p.seat + 1) }}
              >
                {p.nickname}
              </span>

              <span className="ml-auto flex shrink-0 items-center gap-2 text-[11px]">
                {/* No vote counts here: the reveal panel carries the full
                    breakdown, and repeating it made three lists of the same
                    people on one screen. */}
                {isFake && <span className="label-caps text-accent-400">Fake</span>}
                {(yourVote === p.id || picked) && (
                  <span className="label-caps text-accent-400">Your vote</span>
                )}
                {!revealing && state.scores[p.id] > 0 && (
                  <span className="catalogue-no">{state.scores[p.id]}</span>
                )}
                {p.id === sync.hostId && !revealing && <span className="label-caps">Host</span>}
                {p.id === sync.you && <span className="label-caps">You</span>}
                {p.id === drawer && <span className="label-caps text-accent-400">Drawing</span>}
                {balloting && state.voted.includes(p.id) && (
                  <span className="label-caps text-success">Voted</span>
                )}
                {state.absent.includes(p.id) && (
                  <span className="label-caps text-label-700">Dropped</span>
                )}
                {!online && !revealing && !state.absent.includes(p.id) && (
                  <span className="label-caps text-label-700">Away</span>
                )}
                {/* Nothing waits on a dropped player, which is the only way to
                    finish a round somebody has walked out of. */}
                {isHost &&
                  p.id !== sync.you &&
                  !state.absent.includes(p.id) &&
                  state.phase !== "lobby" &&
                  state.phase !== "reveal" &&
                  state.phase !== "complete" && (
                    <button
                      onClick={() => drop.run(p.id)}
                      disabled={drop.pending}
                      title={`Stop waiting for ${p.nickname} this round`}
                      className="label-caps text-label-700 underline hover:text-danger"
                    >
                      Drop
                    </button>
                  )}
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
                    "border bg-wall-900 hover:border-accent-500",
                    picked ? "border-accent-500 bg-accent-500/10" : "border-wall-500",
                    pendingId === p.id && "opacity-60",
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

      {(cast.error || drop.error) && (
        <p role="alert" className="mt-3 text-sm text-danger">{cast.error ?? drop.error}</p>
      )}
      {isHost && state.absent.length > 0 && (
        <p className="mt-3 text-xs text-label-500">
          Dropped players rejoin automatically next round.
        </p>
      )}

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
