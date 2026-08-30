/**
 * The placeholder game: secret simultaneous commits, then deterministic
 * resolution. This is NOT RoboRally, but it is RoboRally-SHAPED -- players
 * choose in secret, everyone reveals at once, and the server resolves
 * conflicts in a fixed order. That is the pattern the sync and storage
 * layers have to survive, so it is the pattern the POC exercises.
 *
 * Each round: every player secretly picks one tile from their private hand,
 * then the server applies all picks in seat order (first claim wins).
 */

export const GRID_SIZE = 5;
export const TILE_COUNT = GRID_SIZE * GRID_SIZE;
export const HAND_SIZE = 5;
export const ROUNDS = HAND_SIZE;

export type GameStatus = "lobby" | "active" | "complete";

/** PUBLIC state. Broadcast to everyone; must contain no secrets. */
export interface GameState {
  /** tile index -> playerId that claimed it. */
  tiles: Record<number, string>;
  scores: Record<string, number>;
  round: number;
  /** Who has committed this round. The FACT is public; the pick is not. */
  committed: string[];
  startedAt: string | null;
  endedAt: string | null;
}

/** PRIVATE per-player state. Never broadcast, never in the event log. */
export interface PrivateState {
  /** Tiles this player may still pick. */
  hand: number[];
  /** This round's secret pick, revealed only at resolution. */
  pending: number | null;
  /** Guards against double-committing within a round. */
  round: number;
}

export function initialGameState(): GameState {
  return { tiles: {}, scores: {}, round: 0, committed: [], startedAt: null, endedAt: null };
}

/**
 * Coerce whatever is in the database into a valid GameState.
 *
 * Cheap insurance: a game row written by an older build (or a field added
 * since) must degrade to a default, never surface as `undefined.length` in
 * a render and take the page down. Applied on every read.
 */
export function normalizeGameState(raw: Partial<GameState> | null | undefined): GameState {
  const base = initialGameState();
  if (!raw || typeof raw !== "object") return base;
  return {
    tiles: raw.tiles && typeof raw.tiles === "object" ? raw.tiles : base.tiles,
    scores: raw.scores && typeof raw.scores === "object" ? raw.scores : base.scores,
    round: typeof raw.round === "number" ? raw.round : base.round,
    committed: Array.isArray(raw.committed) ? raw.committed : base.committed,
    startedAt: typeof raw.startedAt === "string" ? raw.startedAt : null,
    endedAt: typeof raw.endedAt === "string" ? raw.endedAt : null,
  };
}

export interface PlayerInfo {
  id: string;
  nickname: string;
  seat: number;
}

/** One player's revealed pick after resolution. */
export interface ResolvedPick {
  playerId: string;
  tile: number;
  /** False when another player took the tile first this round. */
  applied: boolean;
}

/**
 * The event log. Every payload here is PUBLIC by construction -- that is the
 * invariant that keeps secrets out of broadcasts. `player_committed` says
 * only that someone committed; `round_resolved` is where picks become public,
 * because at that point they are.
 */
export type GameEvent =
  | { seq: number; type: "player_joined"; payload: PlayerInfo }
  | { seq: number; type: "game_started"; payload: { at: string } }
  | { seq: number; type: "player_committed"; payload: { playerId: string; round: number } }
  | {
      seq: number;
      type: "round_resolved";
      payload: { round: number; picks: ResolvedPick[]; at: string };
    }
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
 * Written as a distributive conditional rather than `Omit<GameEvent, "seq">`:
 * a plain Omit over a union collapses it into one object whose `type` and
 * `payload` are no longer correlated, so narrowing on `type` stops working.
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
  /** Whether the requester has actually joined. False for someone who just
   *  followed a shared link -- the client uses this to prompt for a nickname
   *  instead of trying to subscribe to a channel it cannot authorise for. */
  isPlayer: boolean;
  /** ONLY the requesting player's private state. Never anyone else's. */
  privateState: PrivateState | null;
}

/** Deal a secret hand. Overlapping hands are intentional -- they create the
 *  conflicts that resolution has to settle deterministically. */
export function dealHand(rng: () => number = Math.random): number[] {
  const hand = new Set<number>();
  while (hand.size < HAND_SIZE) hand.add(Math.floor(rng() * TILE_COUNT));
  return [...hand].sort((a, b) => a - b);
}
