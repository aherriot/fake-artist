import {
  ARTIST_WIN_POINTS,
  CORRECT_VOTE_POINTS,
  FAKE_ARTIST_WIN_POINTS,
  MIN_PLAYERS,
  initialGameState,
  currentDrawer,
  currentTurn,
  drawingFinished,
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
      const next = { ...state, scores: { ...state.scores, [event.payload.id]: 0 } };
      // Joining between rounds: seat order is fixed at kickoff, so a latecomer
      // has to be appended or they would never get a turn.
      if (state.seatOrder.length > 0 && !state.seatOrder.includes(event.payload.id)) {
        next.seatOrder = [...state.seatOrder, event.payload.id];
      }
      return next;
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
        firstTurn: event.payload.firstTurn ?? 0,
        turnIndex: 0,
        strokes: [],
        voted: [],
        absent: [],
        votes: {},
        runoffCandidates: [],
        accusedId: null,
        guess: null,
        guessVoted: [],
      };

    case "stroke_drawn": {
      // Guard against a duplicate delivery advancing the turn twice: a line
      // only counts from the player whose turn it is.
      const turn = currentTurn(state);
      if (state.phase !== "drawing" || turn === null) return state;
      if (currentDrawer(state) !== event.payload.playerId) return state;
      // Past the turn this line FILLED, which is not always turnIndex: when a
      // dropped player's turn was skipped over, adding one would land the
      // next drawer back on their own turn.
      const next = {
        ...state,
        strokes: [...state.strokes, event.payload],
        turnIndex: turn + 1,
      };
      // The last line opens the vote directly -- no separate discussion phase
      // and no Ready tally to shepherd everyone through.
      return drawingFinished(next) ? openVote(next) : next;
    }

    case "turn_skipped": {
      const turn = currentTurn(state);
      if (state.phase !== "drawing" || turn === null) return state;
      if (currentDrawer(state) !== event.payload.playerId) return state;
      const next = { ...state, turnIndex: turn + 1 };
      return drawingFinished(next) ? openVote(next) : next;
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

    case "player_dropped": {
      if (state.absent.includes(event.payload.playerId)) return state;
      const next = { ...state, absent: [...state.absent, event.payload.playerId] };
      // If they were the only one still to draw, the round moves on.
      return next.phase === "drawing" && drawingFinished(next) ? openVote(next) : next;
    }

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
        fakeHistory: [...state.fakeHistory, r.fakeArtistId],
        usedTopics: [...state.usedTopics, r.topic],
      };
    }

    case "match_ended":
      return { ...state, phase: "complete", endedAt: event.payload.at };

    case "match_reset": {
      // Back to a lobby in the SAME room: same code, same URL, everyone stays
      // put. Scores and history start over; the players do not.
      const scores: Record<string, number> = {};
      for (const id of Object.keys(state.scores)) scores[id] = 0;
      return { ...initialGameState(), scores };
    }

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
 *
 * A winning Fake Artist takes double. See FAKE_ARTIST_WIN_POINTS for why the
 * two sides are not paid the same. When the Fake Artist wins, any real artist
 * who voted for them on the deciding ballot still takes CORRECT_VOTE_POINTS.
 */
export function settleRound(
  state: GameState,
  opts: { fakeArtistId: string; caught: boolean; guessAccepted: boolean | null },
): { winners: string[]; scores: Record<string, number> } {
  const fakeWins = !opts.caught || opts.guessAccepted === true;
  // A player dropped from the round was not in it at the end, so they do not
  // share in a win they took no part in deciding.
  const winners = fakeWins
    ? [opts.fakeArtistId]
    : activePlayers(state).filter((id) => id !== opts.fakeArtistId);
  const round = { winners, fakeArtistId: opts.fakeArtistId, votes: state.votes };
  const scores = { ...state.scores };
  for (const id of new Set([...winners, ...Object.keys(state.votes)])) {
    const gained = roundPoints(id, round);
    if (gained > 0) scores[id] = (scores[id] ?? 0) + gained;
  }
  return { winners, scores };
}

/**
 * What one player collects from a round.
 *
 * Winners are paid by role. A loser scores only as a real artist who named the
 * Fake Artist in a round the Fake Artist won anyway -- when the artists win,
 * their correct votes are already paid for by the win itself.
 *
 * Exported because the reveal shows the delta beside the running total: a
 * score that jumps with nothing saying why reads as a bug. Callers must skip
 * voided rounds, which pay nobody.
 */
export function roundPoints(
  playerId: string,
  r: Pick<RoundResult, "winners" | "fakeArtistId" | "votes">,
): number {
  if (r.winners.includes(playerId)) {
    return playerId === r.fakeArtistId ? FAKE_ARTIST_WIN_POINTS : ARTIST_WIN_POINTS;
  }
  const fakeWon = r.winners.includes(r.fakeArtistId);
  if (fakeWon && playerId !== r.fakeArtistId && r.votes[playerId] === r.fakeArtistId) {
    return CORRECT_VOTE_POINTS;
  }
  return 0;
}

/**
 * Does the room accept the fake artist's guess?
 *
 * At least half of the judges must accept, so an even split accepts. **[ours]**
 *
 * The tie has to fall one way, and it falls to the guess: if half the room
 * reads it as the subject, the fake artist has plausibly named it, and a
 * close guess should not be lost on a technicality.
 *
 * The fake artist is never one of the judges -- they do not get to accept
 * their own guess -- so `judges` is the count of active real artists.
 */
export function guessAccepted(accepts: number, judges: number): boolean {
  // With nobody left to judge there is no half to reach.
  return judges > 0 && accepts * 2 >= judges;
}

/** Players the round still waits on: everyone the host has not dropped. */
export const activePlayers = (state: GameState) =>
  state.seatOrder.filter((id) => !state.absent.includes(id));

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

    case "drop_player": {
      if (ctx.playerId !== ctx.hostId)
        return { ok: false, error: "Only the host can drop a player" };
      // Not at the reveal either: nothing waits on anyone there, and the next
      // round deals everyone back in regardless.
      if (ctx.state.phase === "lobby" || ctx.state.phase === "complete" || ctx.state.phase === "reveal")
        return { ok: false, error: "No round is in progress" };
      return { ok: true };
    }

    case "play_again":
      if (ctx.playerId !== ctx.hostId)
        return { ok: false, error: "Only the host can start a new match" };
      if (ctx.state.phase !== "complete")
        return { ok: false, error: "The match is not over yet" };
      return { ok: true };

    case "end_match":
      // Only between rounds: stopping mid-round would strand a drawing, a
      // ballot, or a guess that people are part-way through.
      if (ctx.playerId !== ctx.hostId)
        return { ok: false, error: "Only the host can end the match" };
      if (ctx.state.phase !== "reveal")
        return { ok: false, error: "The match can only be ended between rounds" };
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

/**
 * Validates a secret vote.
 *
 * A vote may be CHANGED for as long as the ballot is open. Nothing is revealed
 * until every vote is in, so changing your mind leaks nothing to anyone -- and
 * the alternative is that a misclick decides the round. The ballot closes by
 * resolving on the last vote cast, which is what makes this safe.
 */
export function validateVote(
  targetId: string,
  ctx: { state: GameState; playerId: string },
): { ok: true } | { ok: false; error: string } {
  const { state } = ctx;
  if (state.phase !== "voting" && state.phase !== "runoff")
    return { ok: false, error: "Voting is not open" };
  if (!state.seatOrder.includes(ctx.playerId))
    return { ok: false, error: "You are not playing in this match" };
  if (state.absent.includes(ctx.playerId))
    return { ok: false, error: "You were dropped from this round — you are back in next round" };
  if (targetId === ctx.playerId) return { ok: false, error: "You cannot vote for yourself" };
  if (!state.seatOrder.includes(targetId))
    return { ok: false, error: "Not a player in this match" };
  if (state.phase === "runoff" && !state.runoffCandidates.includes(targetId))
    return { ok: false, error: "Not one of the tied players" };
  return { ok: true };
}
