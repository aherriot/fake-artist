"use client";

import { useState } from "react";
import type { useGameSync } from "@/lib/useGameSync";
import { Button, Plaque, penVar } from "@/lib/ui/primitives";
import { useAction } from "@/lib/ui/useAction";
import { clsx } from "clsx";

type Game = ReturnType<typeof useGameSync>;
type Act = (body: unknown) => Promise<string | null | void>;

/**
 * The controls for the current phase.
 *
 * Each phase is its own component so it can own its pending and error state --
 * a switch cannot call hooks. The headline and the "waiting on whom" line live
 * in the status board; what is left here is only what you can press, and what
 * happened when you pressed it.
 */
export function PhasePanel({ game, act, isHost }: { game: Game; act: Act; isHost: boolean }) {
  switch (game.sync.state.phase) {
    case "drawing":
      return <DrawingPanel game={game} act={act} isHost={isHost} />;
    // Voting lives in the roster, beside the seat colours it is judged on.
    case "voting":
    case "runoff":
      return null;
    case "guess":
      return <GuessPanel game={game} />;
    case "guess_vote":
      return <GuessVotePanel game={game} />;
    case "reveal":
    case "complete":
      return <RevealPanel game={game} act={act} isHost={isHost} />;
    default:
      return null;
  }
}

/** Shown to the host only: the escape hatch for a player who has wandered off. */
function DrawingPanel({ game, act, isHost }: { game: Game; act: Act; isHost: boolean }) {
  const { sync } = game;
  const skip = useAction(async () => act({ type: "skip_turn" }));
  const seats = sync.state.seatOrder;
  const drawer = seats[sync.state.turnIndex % Math.max(1, seats.length)];
  const name = sync.players.find((p) => p.id === drawer)?.nickname ?? "they";
  if (drawer === sync.you || !isHost) return null;
  return (
    <Plaque className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <p className="text-sm text-label-500">Is {name} holding things up?</p>
        {skip.error && <p role="alert" className="mt-1 text-sm text-danger">{skip.error}</p>}
      </div>
      <Button size="sm" variant="ghost" disabled={skip.pending} onClick={() => skip.run()}>
        {skip.pending ? "Skipping…" : "Skip their turn"}
      </Button>
    </Plaque>
  );
}

function GuessPanel({ game }: { game: Game }) {
  const { sync } = game;
  const [guess, setGuess] = useState("");
  const submit = useAction(async () => {
    const res = await fetch(`/api/games/${sync.code}/guess`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ guess }),
    }).catch(() => null);
    if (!res) return "Could not reach the server. Your guess was not sent.";
    if (!res.ok) return (await res.json().catch(() => ({}))).error ?? "Could not submit";
    return null;
  });

  if (sync.state.accusedId !== sync.you) {
    return (
      <Plaque>
        <p className="text-sm text-label-300">
          They get one guess at the subject. If they get it, they still win the round.
        </p>
      </Plaque>
    );
  }
  return (
    <Plaque className="border-accent-500/50">
      <p className="label-caps">Your guess</p>
      <div className="mt-3 flex gap-2">
        <input
          autoFocus
          value={guess}
          onChange={(e) => setGuess(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && guess.trim() && submit.run()}
          placeholder="What were they drawing?"
          maxLength={80}
          aria-label="Your guess"
          className="min-w-0 flex-1 rounded-sm border border-wall-500 bg-wall-900 px-3 py-2 text-sm focus:border-accent-500 focus:outline-none"
        />
        <Button variant="primary" onClick={() => submit.run()} disabled={!guess.trim() || submit.pending}>
          {submit.pending ? "Sending…" : "Guess"}
        </Button>
      </div>
      {submit.error && <p role="alert" className="mt-2 text-sm text-danger">{submit.error}</p>}
    </Plaque>
  );
}

function GuessVotePanel({ game }: { game: Game }) {
  const { sync } = game;
  const [choice, setChoice] = useState<boolean | null>(null);
  const fake = sync.privateState?.role === "fake";
  const vote = useAction(async (accept: boolean) => {
    const res = await fetch(`/api/games/${sync.code}/guess-vote`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accept }),
    }).catch(() => null);
    if (!res) return "Could not reach the server. Your judgement was not sent.";
    if (!res.ok) return (await res.json().catch(() => ({}))).error ?? "Could not vote";
    return null;
  });
  const done = sync.you !== null && sync.state.guessVoted.includes(sync.you);

  return (
    <Plaque>
      <p className="label-caps">They guessed</p>
      <p className="mt-2 font-display text-3xl">&ldquo;{sync.state.guess}&rdquo;</p>
      {fake ? (
        <p className="mt-3 text-sm text-label-500">
          You do not get a say in whether your own guess counts.
        </p>
      ) : (
        <>
          <div className="mt-4 flex gap-2">
            <Button
              variant="secondary"
              disabled={done || vote.pending}
              onClick={async () => { setChoice(true); await vote.run(true); }}
            >
              {vote.pending && choice === true ? "Sending…" : "That counts"}
            </Button>
            <Button
              variant="danger"
              disabled={done || vote.pending}
              onClick={async () => { setChoice(false); await vote.run(false); }}
            >
              {vote.pending && choice === false ? "Sending…" : "No, that's wrong"}
            </Button>
          </div>
          {vote.error && <p role="alert" className="mt-3 text-sm text-danger">{vote.error}</p>}
          <p className="mt-3 text-xs text-label-500">
            {sync.state.guessVoted.length} of {sync.players.length - 1} judged
          </p>
        </>
      )}
    </Plaque>
  );
}

function RevealPanel({ game, act, isHost }: { game: Game; act: Act; isHost: boolean }) {
  const { sync } = game;
  const { state } = sync;
  const next = useAction(async () => act({ type: "next_round" }));
  const r = state.results[state.results.length - 1];
  const done = state.phase === "complete";
  if (!r) return null;

  const nameOf = (id: string) => sync.players.find((p) => p.id === id)?.nickname ?? "someone";
  const seatOf = (id: string) => sync.players.find((p) => p.id === id)?.seat ?? 0;
  const fakeWon = r.winners.includes(r.fakeArtistId);

  // target -> who voted for them
  const counts: Record<string, { voters: string[] }> = {};
  for (const [voter, target] of Object.entries(r.votes)) {
    (counts[target] ??= { voters: [] }).voters.push(voter);
  }
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
        <b style={{ color: penVar(seatOf(r.fakeArtistId) + 1) }}>{nameOf(r.fakeArtistId)}</b> was
        the fake artist.{" "}
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

      {/* The ballot, now public. Counts alone hide the interesting part --
          who backed whom, and who was alone in being right. */}
      {Object.keys(r.votes).length > 0 && (
        <div className="mt-5 border-t border-wall-500 pt-4">
          <p className="label-caps mb-2">The vote</p>
          <ul className="space-y-1 text-sm">
            {Object.entries(counts)
              .sort((a, b) => b[1].voters.length - a[1].voters.length)
              .map(([targetId, { voters }]) => {
                const wasFake = targetId === r.fakeArtistId;
                return (
                  <li key={targetId} className="flex flex-wrap items-baseline gap-x-2">
                    <span
                      aria-hidden
                      className="inline-grid size-4 shrink-0 place-items-center rounded-[2px] font-mono text-[9px] text-wall-950"
                      style={{ background: penVar(seatOf(targetId) + 1) }}
                    >
                      {seatOf(targetId) + 1}
                    </span>
                    <span className={wasFake ? "text-accent-400" : "text-label-100"}>
                      {nameOf(targetId)}
                    </span>
                    <span className="text-label-500">
                      {voters.length} {voters.length === 1 ? "vote" : "votes"}
                      {" — "}
                      {voters.map(nameOf).join(", ")}
                    </span>
                    {wasFake && <span className="label-caps text-accent-400">the fake artist</span>}
                  </li>
                );
              })}
          </ul>
        </div>
      )}

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
        <>
          <Button
            variant="primary"
            className="mt-5"
            disabled={next.pending}
            onClick={() => next.run()}
          >
            {next.pending
              ? "Starting…"
              : state.round >= state.totalRounds
                ? "Finish the match"
                : "Next round"}
          </Button>
          {next.error && <p role="alert" className="mt-2 text-sm text-danger">{next.error}</p>}
        </>
      )}
      {done && (
        <p className="mt-5 font-display text-2xl">{ranked[0]?.nickname} wins the match.</p>
      )}
    </Plaque>
  );
}
