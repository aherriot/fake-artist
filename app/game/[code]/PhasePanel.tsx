"use client";

import { useState } from "react";
import type { useGameSync } from "@/lib/useGameSync";
import { Button, Plaque, penTextVar } from "@/lib/ui/primitives";
import { PlayerName } from "@/lib/ui/PlayerName";
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
      return <RevealPanel game={game} act={act} isHost={isHost} />;
    case "complete":
      return <FinalScores game={game} />;
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
  if (drawer === sync.you || !isHost) return null;
  return (
    <Plaque className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <p className="text-sm text-label-500">
          Is <PlayerName id={drawer} players={sync.players} /> holding things up?
        </p>
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
  const end = useAction(async () => act({ type: "end_match" }));
  const [confirming, setConfirming] = useState(false);
  const r = state.results[state.results.length - 1];
  if (!r) return null;
  const lastRound = state.round >= state.totalRounds;

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
      <p className="label-caps">Attribution</p>
      <p className="mt-2 font-display text-3xl">
        The subject was <span className="text-accent-400">{r.topic}</span>
      </p>
      <p className="mt-2 text-sm text-label-300">
        <PlayerName id={r.fakeArtistId} players={sync.players} /> was the fake artist.{" "}
        {r.caught ? (
          r.guessAccepted ? (
            <>Caught — but guessed &ldquo;{r.guess}&rdquo; and got away with it.</>
          ) : (
            <>Caught, and &ldquo;{r.guess}&rdquo; was not it.</>
          )
        ) : r.accusedId ? (
          <>
            The room accused <PlayerName id={r.accusedId} players={sync.players} /> instead.
          </>
        ) : (
          <>The room could not agree, so they walked.</>
        )}
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
                      style={{ background: penTextVar(seatOf(targetId) + 1) }}
                    >
                      {seatOf(targetId) + 1}
                    </span>
                    <PlayerName id={targetId} players={sync.players} />
                    <span className="text-label-500">
                      {voters.length} {voters.length === 1 ? "vote" : "votes"} —{" "}
                      {voters.map((v, i) => (
                        <span key={v}>
                          {i > 0 && ", "}
                          <PlayerName id={v} players={sync.players} bold={false} />
                        </span>
                      ))}
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
              style={{ background: penTextVar(p.seat + 1) }}
            >
              {p.seat + 1}
            </span>
            <PlayerName id={p.id} players={sync.players} bold={p.id === sync.you} />
            <span className="ml-auto catalogue-no">{state.scores[p.id] ?? 0}</span>
          </li>
        ))}
      </ol>

      {isHost ? (
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Button variant="primary" disabled={next.pending} onClick={() => next.run()}>
            {next.pending ? "Starting…" : lastRound ? "Finish the match" : "Next round"}
          </Button>
          {/* Stopping early ends it for everyone, so it asks first. */}
          {!lastRound &&
            (confirming ? (
              <span className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-label-300">
                  End it after {state.round} of {state.totalRounds} rounds?
                </span>
                <Button size="sm" variant="danger" disabled={end.pending} onClick={() => end.run()}>
                  {end.pending ? "Ending…" : "Yes, end it"}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
                  Keep playing
                </Button>
              </span>
            ) : (
              <Button size="sm" variant="ghost" onClick={() => setConfirming(true)}>
                End match here
              </Button>
            ))}
          {(next.error || end.error) && (
            <p role="alert" className="w-full text-sm text-danger">{next.error ?? end.error}</p>
          )}
        </div>
      ) : (
        <p className="mt-5 text-sm text-label-500">Waiting for the host to continue…</p>
      )}
    </Plaque>
  );
}

/**
 * The end of the match.
 *
 * Deliberately not the reveal panel with a different heading: at this point
 * the last round's attribution is history, and what people want is the
 * scoreboard and a recap of what happened.
 */
function FinalScores({ game }: { game: Game }) {
  const { sync } = game;
  const { state } = sync;
  const ranked = [...sync.players].sort(
    (a, b) => (state.scores[b.id] ?? 0) - (state.scores[a.id] ?? 0),
  );
  const top = state.scores[ranked[0]?.id] ?? 0;
  // A tie is entirely possible and saying "Alice wins" would be a lie.
  const winners = ranked.filter((p) => (state.scores[p.id] ?? 0) === top);
  const early = state.results.length < state.totalRounds;

  return (
    <Plaque className="border-success/40">
      <p className="label-caps">Match over</p>

      <p className="mt-2 font-display text-3xl">
        {winners.length === 1 ? (
          <>
            <PlayerName id={winners[0].id} players={sync.players} /> wins
          </>
        ) : (
          <>
            {winners.map((w, i) => (
              <span key={w.id}>
                {i > 0 && (i === winners.length - 1 ? " and " : ", ")}
                <PlayerName id={w.id} players={sync.players} />
              </span>
            ))}
            {" tie"}
          </>
        )}
        {top > 0 && <span className="text-label-500"> on {top}</span>}
      </p>
      <p className="mt-1 text-sm text-label-500">
        {state.results.length} round{state.results.length === 1 ? "" : "s"} played
        {early && ` of ${state.totalRounds} — ended early`}
      </p>

      <ol className="mt-5 space-y-1">
        {ranked.map((p, i) => (
          <li key={p.id} className="flex items-center gap-2 text-sm">
            <span className="w-4 text-right catalogue-no">{i + 1}</span>
            <span
              aria-hidden
              className="grid size-5 place-items-center rounded-[2px] font-mono text-[10px] text-wall-950"
              style={{ background: penTextVar(p.seat + 1) }}
            >
              {p.seat + 1}
            </span>
            <PlayerName id={p.id} players={sync.players} bold={p.id === sync.you} />
            <span className="ml-auto catalogue-no">{state.scores[p.id] ?? 0}</span>
          </li>
        ))}
      </ol>

      {state.results.length > 0 && (
        <div className="mt-6 border-t border-wall-500 pt-4">
          <p className="label-caps mb-2">How it went</p>
          <ul className="space-y-1.5 text-sm">
            {state.results.map((res) => (
              <li key={res.round} className="flex flex-wrap items-baseline gap-x-2">
                <span className="catalogue-no">{res.round}</span>
                <span className="text-label-100">{res.topic}</span>
                <span className="text-label-500">
                  — <PlayerName id={res.fakeArtistId} players={sync.players} bold={false} /> faked
                  it and{" "}
                  {res.winners.includes(res.fakeArtistId) ? (
                    <span className="text-accent-400">got away with it</span>
                  ) : (
                    <span className="text-success">was caught</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Button variant="secondary" href="/" className="mt-6">
        Start another match
      </Button>
    </Plaque>
  );
}
