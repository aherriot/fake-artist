"use client";

import { useState } from "react";
import type { useGameSync } from "@/lib/useGameSync";
import { Button, Plaque, penVar } from "@/lib/ui/primitives";
import { hasVoted, isReady } from "@/lib/game/optimistic";
import { clsx } from "clsx";

/**
 * What the room is being asked to do right now.
 *
 * Every phase advances on participation rather than a clock, so each panel's
 * job is to say plainly who is still holding things up.
 */
export function PhasePanel({
  game,
  act,
  isHost,
}: {
  game: ReturnType<typeof useGameSync>;
  act: (body: unknown) => Promise<void>;
  isHost: boolean;
}) {
  const { sync } = game;
  const { state } = sync;
  const nameOf = (id: string) => sync.players.find((p) => p.id === id)?.nickname ?? "someone";
  const seatOf = (id: string) => sync.players.find((p) => p.id === id)?.seat ?? 0;

  switch (state.phase) {
    case "drawing":
      return <DrawingPanel game={game} act={act} isHost={isHost} nameOf={nameOf} />;

    case "discussion": {
      const ready = isReady(state, sync.pending, sync.you);
      const waiting = sync.players.filter((p) => !state.ready.includes(p.id));
      return (
        <Plaque>
          <p className="label-caps">Discussion</p>
          <p className="mt-2 text-sm text-label-300">
            Talk it over. Who drew like someone who did not know what this was?
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button variant={ready ? "secondary" : "primary"} disabled={ready} onClick={() => act({ type: "ready" })}>
              {ready ? "Ready — waiting for others" : "Ready to vote"}
            </Button>
            <span className="text-xs text-label-500">
              {state.ready.length} of {sync.players.length} ready
              {waiting.length > 0 && waiting.length <= 3 && (
                <> — waiting on {waiting.map((p) => p.nickname).join(", ")}</>
              )}
            </span>
            {isHost && (
              <Button size="sm" variant="ghost" onClick={() => act({ type: "open_voting" })}>
                Open voting now
              </Button>
            )}
          </div>
        </Plaque>
      );
    }

    case "voting":
    case "runoff": {
      const voted = hasVoted(state, sync.pending, sync.you);
      const candidates =
        state.phase === "runoff" && state.runoffCandidates.length > 0
          ? sync.players.filter((p) => state.runoffCandidates.includes(p.id))
          : sync.players;
      return (
        <Plaque>
          <p className="label-caps">
            {state.phase === "runoff" ? "Runoff — the vote was tied" : "Vote"}
          </p>
          <p className="mt-2 text-sm text-label-300">
            {voted
              ? "Your vote is in. Nobody sees it until everyone has voted."
              : "Who is the fake artist? Votes are revealed together."}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {candidates
              .filter((p) => p.id !== sync.you)
              .map((p) => (
                <button
                  key={p.id}
                  disabled={voted}
                  onClick={() => game.castVote(p.id)}
                  className={clsx(
                    "flex items-center gap-2 rounded-sm border px-3 py-2 text-sm transition-colors",
                    voted
                      ? "cursor-not-allowed border-wall-500 opacity-40"
                      : "border-wall-500 bg-wall-900 hover:border-accent-500",
                  )}
                >
                  <span
                    aria-hidden
                    className="grid size-5 place-items-center rounded-[2px] font-mono text-[10px] text-wall-950"
                    style={{ background: penVar(p.seat + 1) }}
                  >
                    {p.seat + 1}
                  </span>
                  {p.nickname}
                </button>
              ))}
          </div>
          <p className="mt-3 text-xs text-label-500">
            {state.voted.length} of {sync.players.length} voted
          </p>
        </Plaque>
      );
    }

    case "guess":
      return <GuessPanel game={game} />;

    case "guess_vote":
      return <GuessVotePanel game={game} />;

    case "reveal":
    case "complete":
      return <RevealPanel game={game} act={act} isHost={isHost} nameOf={nameOf} seatOf={seatOf} />;

    default:
      return null;
  }
}

function DrawingPanel({
  game, act, isHost, nameOf,
}: {
  game: ReturnType<typeof useGameSync>;
  act: (b: unknown) => Promise<void>;
  isHost: boolean;
  nameOf: (id: string) => string;
}) {
  const { sync } = game;
  const drawer = sync.state.seatOrder[sync.state.turnIndex % Math.max(1, sync.state.seatOrder.length)];
  if (drawer === sync.you) return null;
  return (
    <Plaque className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-label-300">
        Waiting for <b className="text-label-100">{nameOf(drawer)}</b> to draw their line.
      </p>
      {isHost && (
        // No timers in v1: a stalled game is the host's to unstick.
        <Button size="sm" variant="ghost" onClick={() => act({ type: "skip_turn" })}>
          Skip them
        </Button>
      )}
    </Plaque>
  );
}

function GuessPanel({ game }: { game: ReturnType<typeof useGameSync> }) {
  const { sync } = game;
  const [guess, setGuess] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const mine = sync.state.accusedId === sync.you;

  async function submit() {
    setErr(null);
    const res = await fetch(`/api/games/${sync.code}/guess`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ guess }),
    });
    if (!res.ok) setErr((await res.json().catch(() => ({}))).error ?? "Could not submit");
  }

  if (!mine) {
    return (
      <Plaque>
        <p className="label-caps">Caught</p>
        <p className="mt-2 text-sm text-label-300">
          The room found the fake artist. They get one guess at the subject — if they get it,
          they still win.
        </p>
      </Plaque>
    );
  }
  return (
    <Plaque className="border-accent-500/50">
      <p className="label-caps">You were caught</p>
      <p className="mt-2 text-sm text-label-300">
        One guess at the subject. Get it right and you still win the round.
      </p>
      <div className="mt-4 flex gap-2">
        <input
          autoFocus
          value={guess}
          onChange={(e) => setGuess(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="What were they drawing?"
          maxLength={80}
          aria-label="Your guess"
          className="min-w-0 flex-1 rounded-sm border border-wall-500 bg-wall-900 px-3 py-2 text-sm focus:border-accent-500 focus:outline-none"
        />
        <Button variant="primary" onClick={submit} disabled={!guess.trim()}>
          Guess
        </Button>
      </div>
      {err && <p role="alert" className="mt-2 text-sm text-danger">{err}</p>}
    </Plaque>
  );
}

function GuessVotePanel({ game }: { game: ReturnType<typeof useGameSync> }) {
  const { sync } = game;
  const [sent, setSent] = useState(false);
  const fake = sync.privateState?.role === "fake";

  async function vote(accept: boolean) {
    setSent(true);
    const res = await fetch(`/api/games/${sync.code}/guess-vote`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accept }),
    });
    if (!res.ok) setSent(false);
  }

  return (
    <Plaque>
      <p className="label-caps">Does that count?</p>
      <p className="mt-2 font-display text-3xl">“{sync.state.guess}”</p>
      {fake ? (
        <p className="mt-3 text-sm text-label-500">
          You guessed. The others decide whether it counts — you do not get a say in that.
        </p>
      ) : (
        <>
          <p className="mt-3 text-sm text-label-300">
            Close enough to the real subject? A tie counts as accepted.
          </p>
          <div className="mt-4 flex gap-2">
            <Button variant="secondary" disabled={sent} onClick={() => vote(true)}>
              That counts
            </Button>
            <Button variant="danger" disabled={sent} onClick={() => vote(false)}>
              No, that&apos;s wrong
            </Button>
          </div>
          <p className="mt-3 text-xs text-label-500">
            {sync.state.guessVoted.length} of {sync.players.length - 1} judged
          </p>
        </>
      )}
    </Plaque>
  );
}

function RevealPanel({
  game, act, isHost, nameOf, seatOf,
}: {
  game: ReturnType<typeof useGameSync>;
  act: (b: unknown) => Promise<void>;
  isHost: boolean;
  nameOf: (id: string) => string;
  seatOf: (id: string) => number;
}) {
  const { sync } = game;
  const { state } = sync;
  const r = state.results[state.results.length - 1];
  const done = state.phase === "complete";
  if (!r) return null;

  const fakeWon = r.winners.includes(r.fakeArtistId);
  const ranked = [...sync.players].sort(
    (a, b) => (state.scores[b.id] ?? 0) - (state.scores[a.id] ?? 0),
  );

  return (
    <Plaque className="border-success/40">
      <p className="label-caps">{done ? "Final attribution" : "Attribution"}</p>
      <p className="mt-2 font-display text-3xl">
        The subject was <span className="text-accent-400">{r.topic}</span>
      </p>
      <p className="mt-2 text-sm text-label-300">
        <b style={{ color: penVar(seatOf(r.fakeArtistId) + 1) }}>{nameOf(r.fakeArtistId)}</b>{" "}
        was the fake artist.{" "}
        {r.caught
          ? r.guessAccepted
            ? `Caught — but guessed "${r.guess}" and got away with it.`
            : `Caught, and "${r.guess}" was not it.`
          : r.accusedId
            ? `The room accused ${nameOf(r.accusedId)} instead.`
            : "The room could not agree, so they walked."}
      </p>
      <p className="mt-2 text-sm">
        {fakeWon ? (
          <span className="text-accent-400">The fake artist wins the round.</span>
        ) : (
          <span className="text-success">The real artists win the round.</span>
        )}
      </p>

      <ol className="mt-5 space-y-1">
        {ranked.map((p) => (
          <li key={p.id} className="flex items-center gap-2 text-sm">
            <span
              aria-hidden
              className="grid size-5 place-items-center rounded-[2px] font-mono text-[10px] text-wall-950"
              style={{ background: penVar(p.seat + 1) }}
            >
              {p.seat + 1}
            </span>
            <span className={p.id === sync.you ? "text-label-100" : "text-label-300"}>
              {p.nickname}
            </span>
            <span className="ml-auto catalogue-no">{state.scores[p.id] ?? 0}</span>
          </li>
        ))}
      </ol>

      {!done && isHost && (
        <Button variant="primary" className="mt-5" onClick={() => act({ type: "next_round" })}>
          {state.round >= state.totalRounds ? "Finish the match" : "Next round"}
        </Button>
      )}
      {!done && !isHost && (
        <p className="mt-5 text-sm text-label-500">Waiting for the host to continue…</p>
      )}
      {done && (
        <p className="mt-5 font-display text-2xl">
          {ranked[0]?.nickname} wins the match.
        </p>
      )}
    </Plaque>
  );
}
