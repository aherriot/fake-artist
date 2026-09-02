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
  strokes: Stroke[];
  /** You pressed Ready to vote. */
  ready: boolean;
  /** You cast a vote (the target stays secret; only the fact is shown). */
  voted: boolean;
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
  ready: false,
  voted: false,
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

  // A stroke of ours that has landed in public state retires one prediction.
  const confirmedMine = you ? state.strokes.filter((s) => s.playerId === you).length : 0;

  return {
    chat: pending.chat.filter((c) => c.failed || !confirmedNonces.has(c.nonce)),
    strokes: pending.strokes.slice(Math.min(confirmedMine, pending.strokes.length)),
    ready: pending.ready && !(you !== null && state.ready.includes(you)),
    voted: pending.voted && !(you !== null && state.voted.includes(you)),
  };
}

/** Predictions the view should show alongside confirmed state. */
export function mergedStrokes(state: GameState, pending: Pending): Stroke[] {
  return [...state.strokes, ...pending.strokes];
}

export const isReady = (state: GameState, pending: Pending, you: string | null) =>
  pending.ready || (you !== null && state.ready.includes(you));

export const hasVoted = (state: GameState, pending: Pending, you: string | null) =>
  pending.voted || (you !== null && state.voted.includes(you));

/**
 * A round boundary invalidates every prediction: strokes are cleared, ballots
 * reset, readiness starts again. Chat survives, since it spans rounds.
 */
export function clearForNewRound(pending: Pending): Pending {
  return { ...pending, strokes: [], ready: false, voted: false };
}
