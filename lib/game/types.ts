/**
 * A Fake Artist Goes to New York — game model.
 *
 * The invariant everything else rests on: **every payload in the event log is
 * public**. Secrets live in `PrivateState`, which is only ever returned to its
 * own owner. If a value would tell you the topic or who the Fake Artist is, it
 * must not appear in a GameEvent.
 */

export const MIN_PLAYERS =
  process.env.NEXT_PUBLIC_ALLOW_TWO_PLAYER_GAMES === "1" ? 2 : 3;
export const MAX_PLAYERS = 10;
/** Two passes around the table: everyone draws twice. */
export const PASSES = 2;

export type GameStatus = "lobby" | "active" | "complete";

/**
 * Round phases. Every phase ends when the people in it have acted -- there are
 * no timers in v1 -- with a host override for anyone stuck.
 *
 * There is no discussion phase: the last line drawn opens the vote directly.
 * Talking still happens, it just happens with the ballot already open, which
 * removes a whole round of "press Ready" bookkeeping from a party game.
 */
export type Phase =
  | "lobby"
  | "drawing"
  | "voting"
  | "runoff"
  | "guess"
  | "guess_vote"
  | "reveal"
  | "complete";

export interface Stroke {
  playerId: string;
  seat: number;
  /** Normalised 0..1 points, so the drawing survives any canvas size. */
  points: [number, number][];
}

export interface RoundResult {
  round: number;
  fakeArtistId: string;
  topic: string;
  category: string;
  /** voterId -> accusedId, revealed only once the round is over. */
  votes: Record<string, string>;
  accusedId: string | null;
  caught: boolean;
  guess: string | null;
  guessAccepted: boolean | null;
  winners: string[];
  /** The fake artist left mid-round, so nobody scores. */
  voided?: boolean;
}

/** PUBLIC state. Broadcast to everyone; must never contain a secret. */
export interface GameState {
  phase: Phase;
  round: number;
  totalRounds: number;
  /** Seat order, fixed for the match. Drawing follows it. */
  seatOrder: string[];
  /** Public from the moment the round starts. The Fake Artist sees it too. */
  category: string | null;
  /** 0..(seats * PASSES - 1). Whose turn is derived from this. */
  turnIndex: number;
  strokes: Stroke[];
  /** Who has voted -- the FACT is public, the vote is not. */
  voted: string[];
  /** Narrowed set during a runoff; empty otherwise. */
  runoffCandidates: string[];
  /**
   * Players the host has dropped from THIS round, so nothing waits on them.
   * Cleared when the next round starts, so a dropped player is back in by
   * default -- if they are still gone, the host drops them again. That is
   * simpler and more forgiving than a match-level removal nobody can undo.
   */
  absent: string[];
  /** Revealed only when the round resolves. */
  votes: Record<string, string>;
  accusedId: string | null;
  guess: string | null;
  guessVoted: string[];
  /** Who was the Fake Artist, one entry per completed round, in order; a
   *  player may appear more than once. Appended at REVEAL, never at round
   *  start, which would leak the current round's Fake Artist immediately. */
  fakeHistory: string[];
  usedTopics: string[];
  scores: Record<string, number>;
  results: RoundResult[];
  startedAt: string | null;
  endedAt: string | null;
}

/**
 * PRIVATE per-player state. Never broadcast, never in the event log, only ever
 * returned to its owner.
 */
export interface PrivateState {
  role: "artist" | "fake";
  /** null for the Fake Artist -- that absence IS the game. */
  topic: string | null;
  /** This round's secret vote, until everyone has voted. */
  vote: string | null;
  guessVote: "accept" | "reject" | null;
}

export function initialGameState(): GameState {
  return {
    phase: "lobby",
    round: 0,
    totalRounds: 0,
    seatOrder: [],
    category: null,
    turnIndex: 0,
    strokes: [],
    voted: [],
    runoffCandidates: [],
    absent: [],
    votes: {},
    accusedId: null,
    guess: null,
    guessVoted: [],
    fakeHistory: [],
    usedTopics: [],
    scores: {},
    results: [],
    startedAt: null,
    endedAt: null,
  };
}

export function normalizeGameState(raw: Partial<GameState> | null | undefined): GameState {
  const base = initialGameState();
  if (!raw || typeof raw !== "object") return base;
  const arr = <T,>(v: unknown, d: T[]): T[] => (Array.isArray(v) ? (v as T[]) : d);
  const obj = <T,>(v: unknown, d: T): T =>
    v && typeof v === "object" && !Array.isArray(v) ? (v as T) : d;
  return {
    phase: typeof raw.phase === "string" ? (raw.phase as Phase) : base.phase,
    round: typeof raw.round === "number" ? raw.round : base.round,
    totalRounds: typeof raw.totalRounds === "number" ? raw.totalRounds : base.totalRounds,
    seatOrder: arr(raw.seatOrder, base.seatOrder),
    category: typeof raw.category === "string" ? raw.category : null,
    turnIndex: typeof raw.turnIndex === "number" ? raw.turnIndex : base.turnIndex,
    strokes: arr(raw.strokes, base.strokes),
    voted: arr(raw.voted, base.voted),
    runoffCandidates: arr(raw.runoffCandidates, base.runoffCandidates),
    absent: arr(raw.absent, base.absent),
    votes: obj(raw.votes, base.votes),
    accusedId: typeof raw.accusedId === "string" ? raw.accusedId : null,
    guess: typeof raw.guess === "string" ? raw.guess : null,
    guessVoted: arr(raw.guessVoted, base.guessVoted),
    fakeHistory: arr(raw.fakeHistory, base.fakeHistory),
    usedTopics: arr(raw.usedTopics, base.usedTopics),
    scores: obj(raw.scores, base.scores),
    results: arr(raw.results, base.results),
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
 * The event log. Note what is ABSENT: no event carries the topic or the Fake
 * Artist's identity until `round_revealed`, when both are public anyway.
 */
export type GameEvent =
  | { seq: number; type: "player_joined"; payload: PlayerInfo }
  | {
      seq: number;
      type: "match_started";
      payload: { at: string; seatOrder: string[]; totalRounds: number };
    }
  | {
      seq: number;
      type: "round_started";
      payload: { round: number; category: string };
    }
  | { seq: number; type: "stroke_drawn"; payload: Stroke }
  | { seq: number; type: "turn_skipped"; payload: { playerId: string } }
  /** The host dropped a player from this round so it can finish without them. */
  | { seq: number; type: "player_dropped"; payload: { playerId: string } }
  /** Only used to open a RUNOFF. The first vote opens itself, when the last
   *  line lands. */
  | { seq: number; type: "voting_started"; payload: { candidates: string[] } }
  | { seq: number; type: "player_voted"; payload: { playerId: string } }
  | {
      seq: number;
      type: "vote_resolved";
      payload: { votes: Record<string, string>; accusedId: string | null; tied: string[] };
    }
  /** Emitted only when the accused really IS the Fake Artist. The reducer is
   *  public and cannot know that, so the server decides and says so here. */
  | { seq: number; type: "guess_opened"; payload: Record<string, never> }
  | { seq: number; type: "guess_submitted"; payload: { guess: string } }
  | { seq: number; type: "guess_voted"; payload: { playerId: string } }
  | {
      seq: number;
      type: "round_revealed";
      payload: RoundResult & { scores: Record<string, number> };
    }
  | { seq: number; type: "match_ended"; payload: { at: string } }
  /** Same room, same code, everyone still here -- a fresh match. */
  | { seq: number; type: "match_reset"; payload: { at: string } }
  | {
      seq: number;
      type: "chat";
      payload: {
        playerId: string;
        nickname: string;
        text: string;
        at: string;
        /** Client-generated id, echoed back so the sender can retire the
         *  optimistic copy it already rendered. Public and meaningless to
         *  anyone else. */
        nonce?: string;
      };
    };

export type GameEventType = GameEvent["type"];

export type DraftEvent = GameEvent extends infer T
  ? T extends GameEvent
    ? Omit<T, "seq">
    : never
  : never;

export type GameAction =
  | { type: "start_match" }
  | { type: "skip_turn" }
  | { type: "next_round" }
  | { type: "end_match" }
  | { type: "drop_player"; playerId: string }
  | { type: "play_again" };

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
  privateState: PrivateState | null;
}

/* ----------------------------------------------------------- derived state */

/** Total drawing turns in a round. */
export const turnsInRound = (seats: number) => seats * PASSES;

/**
 * Whose turn it is, or null if drawing is over.
 *
 * A dropped player is skipped automatically, so the drawing does not stall on
 * someone the host has already removed from the round.
 */
export function currentDrawer(state: GameState): string | null {
  const n = state.seatOrder.length;
  const turns = turnsInRound(n);
  if (n === 0) return null;
  for (let i = state.turnIndex; i < turns; i++) {
    const id = state.seatOrder[i % n];
    if (!state.absent.includes(id)) return id;
  }
  return null;
}

/** True once every remaining player has taken all their turns. */
export const drawingFinished = (state: GameState) =>
  state.seatOrder.length > 0 && currentDrawer(state) === null;

/** Which pass (1-indexed) the drawing is in. */
export const currentPass = (state: GameState) =>
  state.seatOrder.length === 0
    ? 1
    : Math.min(PASSES, Math.floor(state.turnIndex / state.seatOrder.length) + 1);
