/**
 * Game types for "A Fake Artist Goes to New York".
 *
 * The rules are not implemented yet. What IS in place is the shape the sync
 * layer depends on: public state that everyone may see, private per-player
 * state that only its owner ever receives, and an append-only event log whose
 * every payload is public by construction.
 *
 * When the rules land, this file and reduce.ts are what change. The sync
 * layer, the write paths, and the storage split do not.
 */

export type GameStatus = "lobby" | "active" | "complete";

/**
 * 3 is the real minimum: below that the vote is a coin flip. 2 is permitted
 * only behind the dev flag, so the full flow can be exercised across two
 * browsers.
 *
 * NEXT_PUBLIC_ matters here. This module is shared by client and server, and a
 * server-only variable would leave the browser computing 3 while the server
 * allowed 2 -- the Start button would sit disabled on a game the server would
 * happily start.
 */
export const MIN_PLAYERS =
  process.env.NEXT_PUBLIC_ALLOW_TWO_PLAYER_GAMES === "1" ? 2 : 3;
export const MAX_PLAYERS = 10;

/** PUBLIC state. Broadcast to everyone; must never contain a secret. */
export interface GameState {
  round: number;
  startedAt: string | null;
  endedAt: string | null;
}

/**
 * PRIVATE per-player state: never broadcast, never written to the event log,
 * and only ever returned to its own owner.
 *
 * This game needs it -- the secret word and who the fake artist is are both
 * hidden information -- so the table and the "only your own row" guarantee
 * are kept even though the shape is still open.
 */
export type PrivateState = Record<string, unknown>;

export function initialGameState(): GameState {
  return { round: 0, startedAt: null, endedAt: null };
}

export function normalizeGameState(raw: Partial<GameState> | null | undefined): GameState {
  const base = initialGameState();
  if (!raw || typeof raw !== "object") return base;
  return {
    round: typeof raw.round === "number" ? raw.round : base.round,
    startedAt: typeof raw.startedAt === "string" ? raw.startedAt : null,
    endedAt: typeof raw.endedAt === "string" ? raw.endedAt : null,
  };
}

export interface PlayerInfo {
  id: string;
  nickname: string;
  seat: number;
}

/**
 * The event log. Every payload is PUBLIC -- that is the invariant that keeps
 * secrets out of every broadcast. Game-specific events get added here.
 */
export type GameEvent =
  | { seq: number; type: "player_joined"; payload: PlayerInfo }
  | { seq: number; type: "game_started"; payload: { at: string } }
  | { seq: number; type: "game_ended"; payload: { at: string } }
  | {
      seq: number;
      type: "chat";
      payload: { playerId: string; nickname: string; text: string; at: string };
    };

export type GameEventType = GameEvent["type"];

/**
 * A GameEvent before the database assigns its `seq`.
 *
 * A distributive conditional rather than `Omit<GameEvent, "seq">`: a plain
 * Omit over a union collapses it into one object whose `type` and `payload`
 * are no longer correlated, so narrowing on `type` stops working.
 */
export type DraftEvent = GameEvent extends infer T
  ? T extends GameEvent
    ? Omit<T, "seq">
    : never
  : never;

export type GameAction = { type: "start_game" };

export interface Snapshot {
  gameId: string;
  code: string;
  status: GameStatus;
  state: GameState;
  lastSeq: number;
  players: PlayerInfo[];
  hostId: string;
  you: string;
  isPlayer: boolean;
  /** ONLY the requesting player's private state. Never anyone else's. */
  privateState: PrivateState | null;
}
