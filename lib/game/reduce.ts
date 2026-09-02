import {
  MIN_PLAYERS,
  currentDrawer,
  turnsInRound,
  type DraftEvent,
  type GameEvent,
  type GameState,
  type GameStatus,
  type RoundResult,
} from "./types";

/**
 * PURE. Shared verbatim by client and server.
 *
 * Server: computes the public state it persists inside the write transaction.
 * Client: replays events on top of a snapshot to stay in sync.
 *
 * Identical code over an identically-ordered log means the two cannot drift.
 * No Date.now(), no Math.random() -- timestamps and rolls arrive in payloads.
 */
export function reduce(state: GameState, event: GameEvent): GameState {
  switch (event.type) {
    case "player_joined": {
      if (state.scores[event.payload.id] !== undefined) return state;
      return { ...state, scores: { ...state.scores, [event.payload.id]: 0 } };
    }

    case "match_started":
      return {
        ...state,
        phase: "drawing",
        startedAt: event.payload.at,
        seatOrder: event.payload.seatOrder,
        totalRounds: event.payload.totalRounds,
      };

    case "round_started":
      return {
        ...state,
        phase: "drawing",
        round: event.payload.round,
        category: event.payload.category,
        turnIndex: 0,
        strokes: [],
        voted: [],
        votes: {},
        runoffCandidates: [],
        accusedId: null,
        guess: null,
        guessVoted: [],
      };

    case "stroke_drawn": {
      // Guard against a duplicate delivery advancing the turn twice.
      const turns = turnsInRound(state.seatOrder.length);
      if (state.turnIndex >= turns) return state;
      const next = {
        ...state,
        strokes: [...state.strokes, event.payload],
        turnIndex: state.turnIndex + 1,
      };
      // The last line opens the vote directly -- no separate discussion phase
      // and no Ready tally to shepherd everyone through.
      return next.turnIndex >= turns ? openVote(next) : next;
    }

    case "turn_skipped": {
      const turns = turnsInRound(state.seatOrder.length);
      if (state.turnIndex >= turns) return state;
      const next = { ...state, turnIndex: state.turnIndex + 1 };
      return next.turnIndex >= turns ? openVote(next) : next;
    }

    case "voting_started":
      return {
        ...state,
        phase: state.runoffCandidates.length > 0 ? "runoff" : "voting",
        voted: [],
        votes: {},
        runoffCandidates: event.payload.candidates,
      };

    case "player_voted": {
      if (state.voted.includes(event.payload.playerId)) return state;
      return { ...state, voted: [...state.voted, event.payload.playerId] };
    }

    case "vote_resolved": {
      const { votes, accusedId, tied } = event.payload;
      // A tie sends us to a runoff among the tied players -- unless this WAS
      // the runoff, in which case the group has failed to convict.
      if (tied.length > 1 && state.phase !== "runoff") {
        return { ...state, votes, accusedId: null, runoffCandidates: tied, phase: "runoff" };
      }
      // Deliberately does NOT set the phase. Whether an accusation leads to a
      // guess depends on whether the accused is actually the Fake Artist --
      // secret information this reducer must never see. The server appends
      // either `guess_opened` or `round_revealed` next.
      return { ...state, votes, accusedId, runoffCandidates: [] };
    }

    case "guess_opened":
      return { ...state, phase: "guess" };

    case "guess_submitted":
      return { ...state, guess: event.payload.guess, phase: "guess_vote", guessVoted: [] };

    case "guess_voted": {
      if (state.guessVoted.includes(event.payload.playerId)) return state;
      return { ...state, guessVoted: [...state.guessVoted, event.payload.playerId] };
    }

    case "round_revealed": {
      const r = event.payload;
      if (state.results.some((x) => x.round === r.round)) return state; // duplicate
      return {
        ...state,
        phase: "reveal",
        scores: r.scores,
        results: [...state.results, stripScores(r)],
        // Only now does the Fake Artist become public knowledge. Recording it
        // at round start would have leaked the answer immediately.
        hasBeenFake: [...state.hasBeenFake, r.fakeArtistId],
        usedTopics: [...state.usedTopics, r.topic],
      };
    }

    case "match_ended":
      return { ...state, phase: "complete", endedAt: event.payload.at };

    case "chat":
      return state;

    default:
      return state;
  }
}

function stripScores(r: RoundResult & { scores: Record<string, number> }): RoundResult {
  const { scores: _scores, ...rest } = r;
  return rest;
}

/** Open the ballot with a clean slate. */
function openVote(state: GameState): GameState {
  return { ...state, phase: "voting", voted: [], votes: {}, runoffCandidates: [] };
}

export function reduceAll(state: GameState, events: GameEvent[]): GameState {
  return events.reduce(reduce, state);
}

/* ------------------------------------------------------------- vote tally */

/**
 * Tally votes. Returns the accused, or the tied set when there is no clear
 * plurality. Deterministic: no tie is ever broken by arrival order.
 */
export function tally(votes: Record<string, string>): {
  accusedId: string | null;
  tied: string[];
} {
  const counts = new Map<string, number>();
  for (const target of Object.values(votes)) {
    counts.set(target, (counts.get(target) ?? 0) + 1);
  }
  if (counts.size === 0) return { accusedId: null, tied: [] };
  const max = Math.max(...counts.values());
  const top = [...counts.entries()].filter(([, n]) => n === max).map(([id]) => id).sort();
  return top.length === 1 ? { accusedId: top[0], tied: [] } : { accusedId: null, tied: top };
}

/**
 * Who won, and the resulting scores.
 *
 * The Fake Artist wins by evading the vote, by surviving a second tie, or by
 * being caught and then guessing correctly. The real artists win only by
 * catching them AND rejecting the guess.
 */
export function settleRound(
  state: GameState,
  opts: { fakeArtistId: string; caught: boolean; guessAccepted: boolean | null },
): { winners: string[]; scores: Record<string, number> } {
  const fakeWins = !opts.caught || opts.guessAccepted === true;
  const winners = fakeWins
    ? [opts.fakeArtistId]
    : state.seatOrder.filter((id) => id !== opts.fakeArtistId);
  const scores = { ...state.scores };
  for (const id of winners) scores[id] = (scores[id] ?? 0) + 1;
  return { winners, scores };
}

/* --------------------------------------------------------------- validation */

export interface ActionCtx {
  state: GameState;
  status: GameStatus;
  playerId: string;
  hostId: string;
  playerCount: number;
}

/** Server-side validation for public actions. Never trust the client. */
export function validateAction(
  action: { type: string },
  ctx: ActionCtx,
): { ok: true; event?: DraftEvent } | { ok: false; error: string } {
  switch (action.type) {
    case "start_match":
      if (ctx.playerId !== ctx.hostId)
        return { ok: false, error: "Only the host can start the match" };
      if (ctx.status !== "lobby") return { ok: false, error: "The match has already started" };
      if (ctx.playerCount < MIN_PLAYERS)
        return { ok: false, error: `Need at least ${MIN_PLAYERS} players` };
      return { ok: true };

    case "skip_turn": {
      if (ctx.playerId !== ctx.hostId)
        return { ok: false, error: "Only the host can skip a player" };
      if (ctx.state.phase !== "drawing") return { ok: false, error: "Nobody is drawing" };
      const drawer = currentDrawer(ctx.state);
      if (!drawer) return { ok: false, error: "Nobody is drawing" };
      return { ok: true, event: { type: "turn_skipped", payload: { playerId: drawer } } };
    }

    case "next_round":
      if (ctx.playerId !== ctx.hostId)
        return { ok: false, error: "Only the host can start the next round" };
      if (ctx.state.phase !== "reveal")
        return { ok: false, error: "The round is not finished" };
      return { ok: true };

    default:
      return { ok: false, error: `Unknown action: ${action.type}` };
  }
}

/** Validates a stroke submission against whose turn it actually is. */
export function validateStroke(
  points: unknown,
  ctx: { state: GameState; playerId: string },
): { ok: true; points: [number, number][] } | { ok: false; error: string } {
  if (ctx.state.phase !== "drawing") return { ok: false, error: "Not the drawing phase" };
  if (currentDrawer(ctx.state) !== ctx.playerId)
    return { ok: false, error: "It is not your turn" };
  if (!Array.isArray(points) || points.length < 2)
    return { ok: false, error: "A line needs at least two points" };
  if (points.length > 2000) return { ok: false, error: "Line is too complex" };
  for (const p of points) {
    if (
      !Array.isArray(p) || p.length !== 2 ||
      typeof p[0] !== "number" || typeof p[1] !== "number" ||
      !Number.isFinite(p[0]) || !Number.isFinite(p[1]) ||
      p[0] < 0 || p[0] > 1 || p[1] < 0 || p[1] > 1
    ) {
      return { ok: false, error: "Line is out of bounds" };
    }
  }
  return { ok: true, points: points as [number, number][] };
}

/** Validates a secret vote. */
export function validateVote(
  targetId: string,
  ctx: { state: GameState; playerId: string; alreadyVoted: boolean },
): { ok: true } | { ok: false; error: string } {
  const { state } = ctx;
  if (state.phase !== "voting" && state.phase !== "runoff")
    return { ok: false, error: "Voting is not open" };
  if (ctx.alreadyVoted) return { ok: false, error: "You have already voted" };
  if (targetId === ctx.playerId) return { ok: false, error: "You cannot vote for yourself" };
  if (!state.seatOrder.includes(targetId))
    return { ok: false, error: "Not a player in this match" };
  if (state.phase === "runoff" && !state.runoffCandidates.includes(targetId))
    return { ok: false, error: "Not one of the tied players" };
  return { ok: true };
}
