import type { GameEvent, GameState, Stroke } from "./types";

/**
 * Optimistic (unconfirmed) local state.
 *
 * Kept strictly SEPARATE from the reduced authoritative state rather than
 * merged into it. The sync layer's correctness rests on `seq`-ordered events
 * being the only thing that mutates game state; writing guesses into that
 * same object would mean a gap-heal or a reload could not tell a prediction
 * apart from a fact.
 *
 * So: predictions live here, the view merges the two for display only, and
 * every prediction is retired the moment the real event arrives.
 */
export interface Pending {
  chat: PendingChat[];
  /** Your own stroke, drawn locally the instant you submit it. */
  strokes: PendingStroke[];
  /** You cast a vote (the target stays secret from others; only the fact
   *  is public). */
  voted: boolean;
  /** Who you picked, so your own choice shows before the server confirms. */
  votedFor: string | null;
}

export interface PendingStroke extends Stroke {
  /** How many of your lines were already confirmed when you sent this one.
   *  It is confirmed once there are more -- counting alone cannot tell your
   *  second line apart from the first one that landed a pass ago. */
  confirmedBefore: number;
}

export interface PendingChat {
  nonce: string;
  playerId: string;
  nickname: string;
  text: string;
  at: string;
  /** Set when the send failed, so the view can offer a retry. */
  failed?: boolean;
}

export const emptyPending = (): Pending => ({
  chat: [],
  strokes: [],
  voted: false,
  votedFor: null,
});

/**
 * Retire predictions that the authoritative state has caught up with.
 *
 * Only the ARRIVAL of the real thing clears a prediction -- never a timer and
 * never optimism about the request having succeeded. A failed send is left in
 * place, flagged, so the user can retry rather than silently losing a message.
 */
export function reconcile(
  pending: Pending,
  state: GameState,
  you: string | null,
  events: GameEvent[],
): Pending {
  const confirmedNonces = new Set(
    events
      .filter((e): e is Extract<GameEvent, { type: "chat" }> => e.type === "chat")
      .map((e) => e.payload.nonce)
      .filter((n): n is string => typeof n === "string"),
  );

  // A stroke of ours that has landed in public state retires its prediction.
  const confirmedMine = you ? state.strokes.filter((s) => s.playerId === you).length : 0;

  return {
    chat: pending.chat.filter((c) => c.failed || !confirmedNonces.has(c.nonce)),
    strokes: pending.strokes.filter((s) => s.confirmedBefore >= confirmedMine),
    voted: pending.voted && !(you !== null && state.voted.includes(you)),
    // Kept until the round ends: it is the only record of your own choice
    // until the ballot is revealed, and the server never broadcasts it.
    votedFor: pending.votedFor,
  };
}

/** Predictions the view should show alongside confirmed state. */
export function mergedStrokes(state: GameState, pending: Pending): Stroke[] {
  return [...state.strokes, ...pending.strokes];
}

export const hasVoted = (state: GameState, pending: Pending, you: string | null) =>
  pending.voted || (you !== null && state.voted.includes(you));

/**
 * A round boundary invalidates every prediction: strokes cleared, ballots
 * reset. Chat survives, since it spans rounds.
 */
export function clearForNewRound(pending: Pending): Pending {
  return { ...pending, strokes: [], voted: false, votedFor: null };
}
