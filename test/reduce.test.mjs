// Pure state-machine tests: the half of the sync guarantee that runs
// client-side, and the rules the server validates against.
import assert from "node:assert";
const { reduce, reduceAll, tally, settleRound, validateStroke, validateVote, validateAction } =
  await import("../.test-build/reduce.js");
const { initialGameState, normalizeGameState, currentDrawer, currentPass } =
  await import("../.test-build/types.js");

let n = 0;
const ok = (name) => { n++; console.log("PASS " + name); };

const A = "a", B = "b", C = "c";
const seats = [A, B, C];
const join = (id, i) => ({ seq: i + 1, type: "player_joined", payload: { id, nickname: id, seat: i } });

let s = reduceAll(initialGameState(), [join(A, 0), join(B, 1), join(C, 2)]);
assert.deepStrictEqual(s.scores, { a: 0, b: 0, c: 0 });
assert.strictEqual(s.phase, "lobby");
ok("joining seeds scores and stays in lobby");

s = reduce(s, { seq: 4, type: "match_started", payload: { at: "t0", seatOrder: seats, totalRounds: 3 } });
s = reduce(s, { seq: 5, type: "round_started", payload: { round: 1, category: "Something red" } });
assert.strictEqual(s.phase, "drawing");
assert.strictEqual(s.category, "Something red");
assert.strictEqual(currentDrawer(s), A, "seat order drives the first turn");
ok("match and round start put us in drawing");

// --- turn order: 3 seats x 2 passes = 6 turns, then discussion -------------
const stroke = (id, seat, i) => ({
  seq: 10 + i, type: "stroke_drawn",
  payload: { playerId: id, seat, points: [[0, 0], [1, 1]] },
});
let d = s;
const order = [];
for (let i = 0; i < 6; i++) {
  order.push(currentDrawer(d));
  d = reduce(d, stroke(currentDrawer(d), 0, i));
}
assert.deepStrictEqual(order, [A, B, C, A, B, C], "two passes in fixed seat order");
assert.strictEqual(d.phase, "discussion", "drawing ends after the last turn");
assert.strictEqual(d.strokes.length, 6);
ok("two passes in fixed seat order, then discussion");

// A duplicate stroke must not advance the turn twice.
const dup = reduce(d, stroke(A, 0, 99));
assert.strictEqual(dup.turnIndex, d.turnIndex, "duplicate delivery did not advance the turn");
ok("duplicate stroke delivery is idempotent");

// Pass counter
let p = s;
assert.strictEqual(currentPass(p), 1);
for (let i = 0; i < 3; i++) p = reduce(p, stroke(currentDrawer(p), 0, i));
assert.strictEqual(currentPass(p), 2, "second pass begins after everyone has drawn once");
ok("pass counter tracks the two passes");

// A skipped turn advances exactly like a stroke, but leaves no mark.
let k = reduce(s, { seq: 40, type: "turn_skipped", payload: { playerId: A } });
assert.strictEqual(currentDrawer(k), B);
assert.strictEqual(k.strokes.length, 0, "a skip leaves no stroke");
ok("host skip advances the turn without drawing");

// --- readiness --------------------------------------------------------------
let r = reduce(d, { seq: 50, type: "player_ready", payload: { playerId: A } });
r = reduce(r, { seq: 51, type: "player_ready", payload: { playerId: A } });
assert.deepStrictEqual(r.ready, [A], "readiness is idempotent");
ok("readiness is idempotent");

// --- tally ------------------------------------------------------------------
assert.deepStrictEqual(tally({ a: C, b: C, c: A }), { accusedId: C, tied: [] });
assert.deepStrictEqual(tally({ a: B, b: A }), { accusedId: null, tied: [A, B] });
assert.deepStrictEqual(tally({}), { accusedId: null, tied: [] });
// Order of arrival must not decide a tie.
assert.deepStrictEqual(tally({ a: B, b: A }), tally({ b: A, a: B }));
ok("tally finds a plurality, and ties are order-independent");

// --- tie sends us to a runoff, a second tie does not ------------------------
let v = reduce(d, { seq: 60, type: "voting_started", payload: { candidates: [] } });
assert.strictEqual(v.phase, "voting");
v = reduce(v, { seq: 61, type: "vote_resolved", payload: { votes: { a: B, b: A }, accusedId: null, tied: [A, B] } });
assert.strictEqual(v.phase, "runoff", "a tie opens a runoff");
assert.deepStrictEqual(v.runoffCandidates, [A, B]);
v = reduce(v, { seq: 62, type: "vote_resolved", payload: { votes: { c: A }, accusedId: null, tied: [A, B] } });
assert.strictEqual(v.phase, "runoff", "a second tie does not loop into another runoff");
assert.deepStrictEqual(v.runoffCandidates, [], "runoff candidates are cleared");
// The server ends it, because ending it means naming the fake artist.
v = reduce(v, {
  seq: 63, type: "round_revealed",
  payload: {
    round: 1, fakeArtistId: C, topic: "Tomato", category: "Something red",
    votes: { c: A }, accusedId: null, caught: false, guess: null,
    guessAccepted: null, winners: [C], scores: { a: 0, b: 0, c: 1 },
  },
});
assert.strictEqual(v.phase, "reveal");
ok("a tie opens a runoff; a second tie does not, and the server ends the round");

// An accusation records the accused but must NOT itself open the guess:
// whether a guess happens depends on who the fake artist is, which is secret
// and therefore not the reducer's decision to make.
let g = reduce(d, { seq: 70, type: "voting_started", payload: { candidates: [] } });
g = reduce(g, { seq: 71, type: "vote_resolved", payload: { votes: { a: C, b: C }, accusedId: C, tied: [] } });
assert.strictEqual(g.accusedId, C);
assert.notStrictEqual(g.phase, "guess", "the reducer must not infer the guess phase");
g = reduce(g, { seq: 72, type: "guess_opened", payload: {} });
assert.strictEqual(g.phase, "guess", "the server opens the guess explicitly");
g = reduce(g, { seq: 73, type: "guess_submitted", payload: { guess: "Tomato" } });
assert.strictEqual(g.phase, "guess_vote");
ok("an accusation records the accused; only the server opens a guess");

// Accusing an innocent ends the round outright -- no guess, fake escapes.
let inn = reduce(d, { seq: 74, type: "voting_started", payload: { candidates: [] } });
inn = reduce(inn, { seq: 75, type: "vote_resolved", payload: { votes: { a: B, c: B }, accusedId: B, tied: [] } });
inn = reduce(inn, {
  seq: 76, type: "round_revealed",
  payload: {
    round: 1, fakeArtistId: C, topic: "Tomato", category: "Something red",
    votes: { a: B, c: B }, accusedId: B, caught: false, guess: null,
    guessAccepted: null, winners: [C], scores: { a: 0, b: 0, c: 1 },
  },
});
assert.strictEqual(inn.phase, "reveal");
assert.strictEqual(inn.scores[C], 1, "the fake artist scores when an innocent is accused");
ok("accusing an innocent ends the round and the fake escapes");

// --- scoring ----------------------------------------------------------------
const base = { ...d, scores: { a: 0, b: 0, c: 0 } };
let w = settleRound(base, { fakeArtistId: C, caught: false, guessAccepted: null });
assert.deepStrictEqual(w.winners, [C]);
assert.deepStrictEqual(w.scores, { a: 0, b: 0, c: 1 });
w = settleRound(base, { fakeArtistId: C, caught: true, guessAccepted: true });
assert.deepStrictEqual(w.winners, [C], "caught but guessed right: fake still wins");
w = settleRound(base, { fakeArtistId: C, caught: true, guessAccepted: false });
assert.deepStrictEqual(w.winners.sort(), [A, B], "caught and guess rejected: artists win");
assert.deepStrictEqual(w.scores, { a: 1, b: 1, c: 0 });
ok("all four win conditions score correctly");

// --- reveal is the only place the fake becomes public -----------------------
const result = {
  round: 1, fakeArtistId: C, topic: "Tomato", category: "Something red",
  votes: { a: C, b: C }, accusedId: C, caught: true, guess: "Tomato",
  guessAccepted: true, winners: [C], scores: { a: 0, b: 0, c: 1 },
};
let rev = reduce(g, { seq: 80, type: "round_revealed", payload: result });
assert.deepStrictEqual(rev.hasBeenFake, [C], "fake recorded only at reveal");
assert.deepStrictEqual(rev.usedTopics, ["Tomato"]);
assert.strictEqual(rev.results.length, 1);
assert.strictEqual(rev.results[0].scores, undefined, "scores are not duplicated into the result");
const revDup = reduce(rev, { seq: 80, type: "round_revealed", payload: result });
assert.deepStrictEqual(revDup.hasBeenFake, [C], "duplicate reveal does not double-record");
assert.strictEqual(revDup.results.length, 1);
ok("reveal records the fake once, and is idempotent");

// --- the reload-resume guarantee -------------------------------------------
const evs = [
  join(A, 0), join(B, 1), join(C, 2),
  { seq: 4, type: "match_started", payload: { at: "t0", seatOrder: seats, totalRounds: 3 } },
  { seq: 5, type: "round_started", payload: { round: 1, category: "Something red" } },
  stroke(A, 0, 0), stroke(B, 1, 1),
];
const full = reduceAll(initialGameState(), evs);
const resumed = reduceAll(reduceAll(initialGameState(), evs.slice(0, 4)), evs.slice(4));
assert.deepStrictEqual(resumed, full, "snapshot + tail == full replay");
ok("snapshot+tail equals full replay (reload-resume)");

// --- validation -------------------------------------------------------------
const drawing = reduceAll(initialGameState(), evs);
assert.strictEqual(validateStroke([[0, 0], [1, 1]], { state: drawing, playerId: C }).ok, true);
assert.strictEqual(validateStroke([[0, 0], [1, 1]], { state: drawing, playerId: A }).ok, false, "not your turn");
assert.strictEqual(validateStroke([[0, 0]], { state: drawing, playerId: C }).ok, false, "needs 2 points");
assert.strictEqual(validateStroke([[0, 0], [2, 0]], { state: drawing, playerId: C }).ok, false, "out of bounds");
assert.strictEqual(validateStroke("nope", { state: drawing, playerId: C }).ok, false, "not an array");
ok("stroke validation enforces turn, shape, and bounds");

const voting = reduce(d, { seq: 90, type: "voting_started", payload: { candidates: [] } });
assert.strictEqual(validateVote(B, { state: voting, playerId: A, alreadyVoted: false }).ok, true);
assert.strictEqual(validateVote(A, { state: voting, playerId: A, alreadyVoted: false }).ok, false, "no self-vote");
assert.strictEqual(validateVote(B, { state: voting, playerId: A, alreadyVoted: true }).ok, false, "no double vote");
assert.strictEqual(validateVote("zz", { state: voting, playerId: A, alreadyVoted: false }).ok, false, "unknown player");
assert.strictEqual(validateVote(B, { state: d, playerId: A, alreadyVoted: false }).ok, false, "voting not open");
const runoff = { ...voting, phase: "runoff", runoffCandidates: [A, B] };
assert.strictEqual(validateVote(C, { state: runoff, playerId: A, alreadyVoted: false }).ok, false, "runoff is limited to tied players");
ok("vote validation enforces phase, self-vote, duplicates and runoff set");

const hostCtx = { state: d, status: "active", playerId: A, hostId: A, playerCount: 3 };
assert.strictEqual(validateAction({ type: "skip_turn" }, hostCtx).ok, false, "cannot skip outside drawing");
assert.strictEqual(validateAction({ type: "open_voting" }, hostCtx).ok, true);
assert.strictEqual(
  validateAction({ type: "open_voting" }, { ...hostCtx, playerId: B }).ok, false, "host only");
ok("action validation enforces host-only and phase");

// --- legacy rows degrade rather than crash ---------------------------------
assert.deepStrictEqual(normalizeGameState(null), initialGameState());
assert.deepStrictEqual(normalizeGameState({ strokes: "bad", scores: [] }).strokes, []);
assert.strictEqual(normalizeGameState({ round: "x" }).round, 0);
ok("legacy or partial state normalises to defaults");

console.log(`\nAll ${n} state-machine invariants hold.`);
