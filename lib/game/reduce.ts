import type { DraftEvent, GameEvent, GameState, GameStatus } from "./types";
import { MIN_PLAYERS } from "./types";

/**
 * PURE. Shared verbatim by client and server.
 *
 * Server: computes the public state it persists inside the write transaction.
 * Client: replays events on top of a snapshot to stay in sync.
 *
 * Because both run identical code over an identically-ordered log they cannot
 * drift. Keep it free of Date.now(), Math.random(), and anything else
 * non-deterministic -- timestamps arrive inside payloads.
 */
export function reduce(state: GameState, event: GameEvent): GameState {
  switch (event.type) {
    case "player_joined":
      return state;

    case "game_started":
      return { ...state, startedAt: event.payload.at, round: 1 };

    case "game_ended":
      return { ...state, endedAt: event.payload.at };

    case "chat":
      // Chat rides the same log so it replays on reload, but carries no state.
      return state;

    default:
      return state;
  }
}

export function reduceAll(state: GameState, events: GameEvent[]): GameState {
  return events.reduce(reduce, state);
}

/** Server-side validation for public actions. Never trust the client. */
export function validateAction(
  action: { type: string },
  ctx: {
    state: GameState;
    status: GameStatus;
    playerId: string;
    hostId: string;
    playerCount: number;
  },
): { ok: true; event: DraftEvent } | { ok: false; error: string } {
  switch (action.type) {
    case "start_game": {
      if (ctx.playerId !== ctx.hostId)
        return { ok: false, error: "Only the host can start the game" };
      if (ctx.status !== "lobby")
        return { ok: false, error: "Game has already started" };
      if (ctx.playerCount < MIN_PLAYERS)
        return { ok: false, error: `Need at least ${MIN_PLAYERS} players` };
      return {
        ok: true,
        event: { type: "game_started", payload: { at: new Date().toISOString() } },
      };
    }
    default:
      return { ok: false, error: `Unknown action: ${action.type}` };
  }
}
