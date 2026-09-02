import { sql } from "drizzle-orm";
import type { Tx } from "./mutate";
import { initPrivateState } from "./private";
import { pickPair } from "./words";
import { settleRound, tally } from "./reduce";
import type { DraftEvent, GameState, PrivateState, RoundResult } from "./types";
import { pickFakeArtist, shuffle } from "./selection";

/**
 * Round orchestration: the server-side half of the rules.
 *
 * Everything secret is decided here, inside a transaction, and written to
 * `player_state`. Nothing in this file may put a topic or a Fake Artist's
 * identity into a returned event -- that is the one rule the whole design
 * rests on, and `round_revealed` is the single deliberate exception, fired
 * when both are public anyway.
 */

/**
 * Open a round: pick the pair, pick the Fake Artist, seed every private row.
 *
 * Returns only the PUBLIC event. The topic reaches players exclusively through
 * their own `player_state` row, and the Fake Artist's row has `topic: null` --
 * that absence is the game.
 */
export async function openRound(
  tx: Tx,
  gameId: string,
  state: GameState,
  round: number,
  rng: () => number = Math.random,
): Promise<DraftEvent> {
  // Used categories come from past results, so no extra state is needed --
  // and a category is only "used" once its round has actually been revealed.
  const pair = pickPair(state.usedTopics, state.results.map((r) => r.category), rng);
  const fakeArtistId = pickFakeArtist(state.seatOrder, state.fakeHistory, rng);

  await initPrivateState(
    tx,
    gameId,
    state.seatOrder.map((id) => ({
      playerId: id,
      data: {
        role: id === fakeArtistId ? "fake" : "artist",
        // The Fake Artist's row has no topic. That absence is the game.
        topic: id === fakeArtistId ? null : pair.topic,
        vote: null,
        guessVote: null,
      } satisfies PrivateState,
    })),
  );

  return { type: "round_started", payload: { round, category: pair.category } };
}

/** Read every player's private row for this game. */
export async function readPrivateRows(
  tx: Tx,
  gameId: string,
): Promise<{ playerId: string; data: PrivateState }[]> {
  const rows = await tx.execute<{ player_id: string; data: PrivateState }>(sql`
    SELECT player_id, data FROM player_state WHERE game_id = ${gameId}::uuid
  `);
  return rows.rows.map((r) => ({ playerId: r.player_id, data: r.data }));
}

/**
 * Settle a round once its outcome is known, and produce the reveal.
 *
 * This is the only place a topic and a Fake Artist's identity enter the event
 * log, and by this point both are public information.
 */
export function revealRound(
  state: GameState,
  opts: {
    fakeArtistId: string;
    topic: string;
    caught: boolean;
    guess: string | null;
    guessAccepted: boolean | null;
  },
): DraftEvent {
  const { winners, scores } = settleRound(state, {
    fakeArtistId: opts.fakeArtistId,
    caught: opts.caught,
    guessAccepted: opts.guessAccepted,
  });
  const result: RoundResult = {
    round: state.round,
    fakeArtistId: opts.fakeArtistId,
    topic: opts.topic,
    category: state.category ?? "",
    votes: state.votes,
    accusedId: state.accusedId,
    caught: opts.caught,
    guess: opts.guess,
    guessAccepted: opts.guessAccepted,
    winners,
  };
  return { type: "round_revealed", payload: { ...result, scores } };
}

/**
 * Fold a completed secret ballot into public events.
 *
 * Called when the last player votes. A tie produces a runoff among the tied
 * players; a second tie means the group failed to convict and the Fake Artist
 * escapes. Returns the events to append, and whether the round is now over.
 */
export function resolveVote(
  state: GameState,
  votes: Record<string, string>,
): { events: DraftEvent[]; accusedId: string | null; tied: string[] } {
  const { accusedId, tied } = tally(votes);
  const events: DraftEvent[] = [
    { type: "vote_resolved", payload: { votes, accusedId, tied } },
  ];
  // A tie in the runoff itself is terminal -- we do not loop forever.
  if (tied.length > 1 && state.phase !== "runoff") {
    events.push({ type: "voting_started", payload: { candidates: tied } });
  }
  return { events, accusedId, tied };
}

/**
 * The follow-up to a resolved ballot, decided by the server because it turns
 * on secret information.
 *
 * The room only wins by accusing the Fake Artist specifically. Accusing an
 * innocent -- or failing to agree at all -- means the Fake Artist escapes and
 * the round ends there, with no guess.
 */
export function afterVote(
  state: GameState,
  opts: { accusedId: string | null; fakeArtistId: string; topic: string },
): DraftEvent {
  const caught = opts.accusedId !== null && opts.accusedId === opts.fakeArtistId;
  if (caught) return { type: "guess_opened", payload: {} };
  return revealRound({ ...state, accusedId: opts.accusedId }, {
    fakeArtistId: opts.fakeArtistId,
    topic: opts.topic,
    caught: false,
    guess: null,
    guessAccepted: null,
  });
}

/**
 * Clear only the ballots, keeping roles and topics.
 *
 * Must run whenever a runoff opens. Without it every player still holds their
 * first-round vote, `validateVote` rejects their runoff vote as a duplicate,
 * and the round deadlocks in the runoff phase forever -- which is exactly what
 * happened before this existed.
 */
export async function clearVotes(
  tx: Tx,
  gameId: string,
  exceptPlayerId: string,
): Promise<void> {
  // The acting player is excluded on purpose. mutatePlayer writes their row
  // itself, under a version guard read before produce() ran -- bumping the
  // version here would make that guard fail, and the retry would loop into a
  // 409 rather than clearing anything.
  await tx.execute(sql`
    UPDATE player_state
       SET data = data || '{"vote":null}'::jsonb,
           version = version + 1, updated_at = now()
     WHERE game_id = ${gameId}::uuid AND player_id <> ${exceptPlayerId}::uuid
  `);
}

/** Clear per-round secrets so a stale vote cannot leak into the next round. */
export async function clearBallots(tx: Tx, gameId: string): Promise<void> {
  await tx.execute(sql`
    UPDATE player_state
       SET data = data || '{"vote":null,"guessVote":null}'::jsonb,
           version = version + 1, updated_at = now()
     WHERE game_id = ${gameId}::uuid
  `);
}

export { pickFakeArtist, shuffle };
