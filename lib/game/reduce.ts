import type { DraftEvent, GameEvent, GameState, PrivateState, ResolvedPick } from "./types";
import { ROUNDS, TILE_COUNT } from "./types";

/**
 * PURE. Shared verbatim by client and server.
 *
 * Server: computes the public state it persists inside the write transaction.
 * Client: replays events on top of a snapshot to stay in sync.
 *
 * Because both sides run identical code over an identically-ordered event
 * log, they cannot drift. Keep this free of Date.now(), Math.random(), and
 * anything else non-deterministic -- timestamps arrive inside payloads.
 */
export function reduce(state: GameState, event: GameEvent): GameState {
  switch (event.type) {
    case "player_joined": {
      if (state.scores[event.payload.id] !== undefined) return state;
      return { ...state, scores: { ...state.scores, [event.payload.id]: 0 } };
    }

    case "game_started":
      return { ...state, startedAt: event.payload.at, round: 1, committed: [] };

    case "player_committed": {
      // Only the FACT of committing is public. The pick stays in player_state
      // until resolution reveals it.
      if (state.committed.includes(event.payload.playerId)) return state;
      return { ...state, committed: [...state.committed, event.payload.playerId] };
    }

    case "round_resolved": {
      const tiles = { ...state.tiles };
      const scores = { ...state.scores };
      // Picks arrive pre-ordered by seat; first claim on a tile wins.
      for (const pick of event.payload.picks) {
        if (!pick.applied) continue;
        if (tiles[pick.tile] !== undefined) continue;
        tiles[pick.tile] = pick.playerId;
        scores[pick.playerId] = (scores[pick.playerId] ?? 0) + 1;
      }
      return { ...state, tiles, scores, round: state.round + 1, committed: [] };
    }

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

export function isComplete(state: GameState): boolean {
  return state.round > ROUNDS || Object.keys(state.tiles).length >= TILE_COUNT;
}

/**
 * Resolve one round: apply every player's secret pick in SEAT ORDER.
 *
 * Deterministic by construction -- given the same picks and seats, every
 * observer computes the same outcome. Ties are settled by seat, never by
 * arrival time, so network latency cannot influence the game.
 */
export function resolveRound(
  state: GameState,
  picks: { playerId: string; seat: number; tile: number }[],
): ResolvedPick[] {
  const taken = new Set(Object.keys(state.tiles).map(Number));
  return [...picks]
    .sort((a, b) => a.seat - b.seat)
    .map(({ playerId, tile }) => {
      const applied = !taken.has(tile);
      if (applied) taken.add(tile);
      return { playerId, tile, applied };
    });
}

/** Validates a private commit against the player's own hand. */
export function validateCommit(
  tile: number,
  priv: PrivateState,
  state: GameState,
): { ok: true } | { ok: false; error: string } {
  if (priv.round !== state.round) return { ok: false, error: "Round has moved on" };
  if (priv.pending !== null) return { ok: false, error: "Already committed this round" };
  if (!priv.hand.includes(tile)) return { ok: false, error: "That tile is not in your hand" };
  return { ok: true };
}

/** Server-side validation for public actions. */
export function validateAction(
  action: { type: string },
  ctx: { state: GameState; status: string; playerId: string; hostId: string },
): { ok: true; event: DraftEvent } | { ok: false; error: string } {
  switch (action.type) {
    case "start_game": {
      if (ctx.playerId !== ctx.hostId)
        return { ok: false, error: "Only the host can start the game" };
      if (ctx.status !== "lobby") return { ok: false, error: "Game has already started" };
      if (Object.keys(ctx.state.scores).length < 2)
        return { ok: false, error: "Need at least 2 players" };
      return {
        ok: true,
        event: { type: "game_started", payload: { at: new Date().toISOString() } },
      };
    }
    default:
      return { ok: false, error: `Unknown action: ${action.type}` };
  }
}
