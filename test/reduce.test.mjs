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


// --- optimistic reconciliation ---------------------------------------------
const { emptyPending, reconcile, isReady, hasVoted, clearForNewRound, mergedStrokes } =
  await import("../.test-build/optimistic.js");

const you = "a";
const chatEv = (nonce) => ({
  seq: 1, type: "chat",
  payload: { playerId: you, nickname: "A", text: "hi", at: "t", nonce },
});
let pend = { ...emptyPending(), chat: [{ nonce: "n1", playerId: you, nickname: "A", text: "hi", at: "t" }] };

// The prediction is retired by the ARRIVAL of the real event, not by a timer.
assert.strictEqual(reconcile(pend, initialGameState(), you, []).chat.length, 1, "held until confirmed");
assert.strictEqual(reconcile(pend, initialGameState(), you, [chatEv("n1")]).chat.length, 0, "retired on arrival");
assert.strictEqual(reconcile(pend, initialGameState(), you, [chatEv("other")]).chat.length, 1, "someone else's message does not retire ours");
ok("optimistic chat is retired only by its own confirmation");

// A failed send is kept so the user can retry rather than silently losing it.
const failed = { ...pend, chat: [{ ...pend.chat[0], failed: true }] };
assert.strictEqual(reconcile(failed, initialGameState(), you, [chatEv("n1")]).chat.length, 1, "failed messages survive");
ok("a failed message is never silently dropped");

// Readiness and voting clear once public state shows them.
let p2 = { ...emptyPending(), ready: true, voted: true };
const st2 = { ...initialGameState(), ready: [you], voted: [you] };
assert.strictEqual(reconcile(p2, st2, you, []).ready, false);
assert.strictEqual(reconcile(p2, st2, you, []).voted, false);
assert.strictEqual(isReady(initialGameState(), p2, you), true, "prediction shows before confirmation");
assert.strictEqual(hasVoted(st2, emptyPending(), you), true, "confirmation shows without prediction");
ok("readiness and voting merge prediction with confirmation");

// One confirmed stroke of ours retires exactly one prediction.
const mine = { playerId: you, seat: 0, points: [[0,0],[1,1]] };
let p3 = { ...emptyPending(), strokes: [mine, mine] };
const st3 = { ...initialGameState(), strokes: [{ ...mine }] };
assert.strictEqual(reconcile(p3, st3, you, []).strokes.length, 1, "one confirmed retires one");
assert.strictEqual(mergedStrokes(st3, p3).length, 3, "view shows confirmed + pending");
const st4 = { ...initialGameState(), strokes: [{ ...mine }, { ...mine }, { playerId: "b", seat: 1, points: [] }] };
assert.strictEqual(reconcile(p3, st4, you, []).strokes.length, 0, "others' strokes do not retire ours");
ok("stroke predictions retire one-for-one against your own confirmed strokes");

// A new round invalidates per-round predictions but not chat.
const p5 = { chat: [{ nonce: "x", playerId: you, nickname: "A", text: "t", at: "t" }], strokes: [mine], ready: true, voted: true };
const cleared = clearForNewRound(p5);
assert.strictEqual(cleared.strokes.length, 0);
assert.strictEqual(cleared.ready, false);
assert.strictEqual(cleared.voted, false);
assert.strictEqual(cleared.chat.length, 1, "chat spans rounds");
ok("a new round clears per-round predictions but keeps chat");


// --- the word list ----------------------------------------------------------
const { CATEGORIES, WORD_PAIRS, pickPair, MIN_TOPICS_PER_CATEGORY } =
  await import("../.test-build/words.js");

// The property the whole design rests on: knowing the public category must not
// tell you the secret topic. A category with one topic hands over the answer.
for (const c of CATEGORIES) {
  assert.ok(
    c.topics.length >= MIN_TOPICS_PER_CATEGORY,
    `"${c.category}" has only ${c.topics.length} topics; the category would narrow the answer too far`,
  );
  assert.strictEqual(new Set(c.topics).size, c.topics.length, `"${c.category}" repeats a topic`);
}
ok(`every category offers at least ${MIN_TOPICS_PER_CATEGORY} topics`);

// Topics recur across categories, so the mapping cannot be memorised either way.
const catsOf = new Map();
for (const c of CATEGORIES) for (const t of c.topics) catsOf.set(t, (catsOf.get(t) ?? 0) + 1);
assert.ok([...catsOf.values()].filter((n) => n > 1).length >= 10,
  "too few topics appear under more than one category; the reverse mapping is learnable");
ok("topics recur across categories, so the mapping is many-to-many");

// Never repeat a topic while unused ones remain.
const seen = [];
const cats = [];
for (let i = 0; i < 40; i++) {
  const p = pickPair(seen, cats);
  assert.ok(!seen.includes(p.topic), `pickPair repeated "${p.topic}" after ${i} rounds`);
  seen.push(p.topic);
  cats.push(p.category);
}
ok("40 consecutive rounds never repeat a topic");

// Prefers a fresh category, for variety within a match.
const used = CATEGORIES.slice(0, CATEGORIES.length - 1).map((c) => c.category);
assert.strictEqual(pickPair([], used).category, CATEGORIES[CATEGORIES.length - 1].category,
  "should pick the one unused category");
ok("pickPair prefers a category the match has not used");

// Degrades rather than failing once everything is exhausted.
const all = WORD_PAIRS.map((p) => p.topic);
const exhausted = pickPair(all, CATEGORIES.map((c) => c.category));
assert.ok(exhausted.topic && exhausted.category, "must still return a pair when exhausted");
ok("an exhausted list falls back instead of failing a long match");


// --- whose move is it -------------------------------------------------------
const { turnStatus, listOf } = await import("../.test-build/status.js");

const P = [
  { id: "a", nickname: "Alice", seat: 0 },
  { id: "b", nickname: "Bob", seat: 1 },
  { id: "c", nickname: "Cara", seat: 2 },
];
const base2 = { ...initialGameState(), seatOrder: ["a", "b", "c"], round: 1, totalRounds: 3 };
const ts = (state, you, extra = {}) =>
  turnStatus({ state, you, hostId: "a", players: P, privateState: null, ...extra });

// The single most important bit: does the viewer have to act?
assert.strictEqual(ts({ ...base2, phase: "drawing", turnIndex: 0 }, "a").yours, true);
assert.strictEqual(ts({ ...base2, phase: "drawing", turnIndex: 0 }, "b").yours, false);
assert.match(ts({ ...base2, phase: "drawing", turnIndex: 0 }, "b").headline, /Alice/);
assert.match(ts({ ...base2, phase: "drawing", turnIndex: 1 }, "b").headline, /Your turn/);
ok("drawing says whose turn it is, from either side");

// Readiness and votes flip the viewer from acting to waiting, and name who on.
const disc = { ...base2, phase: "discussion", ready: ["a"] };
assert.strictEqual(ts(disc, "b").yours, true, "not yet ready -> must act");
assert.strictEqual(ts(disc, "a").yours, false, "already ready -> waiting");
assert.match(ts(disc, "a").headline, /Bob and Cara/, "names who is holding it up");
ok("discussion names exactly who is still to press Ready");

// Optimistic flags stop the board flickering back to "your move".
assert.strictEqual(ts(disc, "b", { ready: true }).yours, false, "optimistic ready counts");
const vote = { ...base2, phase: "voting", voted: [] };
assert.strictEqual(ts(vote, "a", { voted: true }).yours, false, "optimistic vote counts");
ok("optimistic readiness and votes are respected");

// Only the accused guesses; only the others judge it.
const guess = { ...base2, phase: "guess", accusedId: "c" };
assert.strictEqual(ts(guess, "c").yours, true);
assert.match(ts(guess, "a").headline, /Cara/);
const gv = { ...base2, phase: "guess_vote", accusedId: "c", guessVoted: [] };
assert.strictEqual(ts(gv, "c", { privateState: { role: "fake" } }).yours, false,
  "the fake artist never judges their own guess");
assert.strictEqual(ts(gv, "a", { privateState: { role: "artist" } }).yours, true);
ok("the guess and its judgement go to the right people");

// Host-gated phases.
assert.strictEqual(ts({ ...base2, phase: "lobby" }, "a").yours, true, "host starts");
assert.strictEqual(ts({ ...base2, phase: "lobby" }, "b").yours, false);
assert.strictEqual(ts({ ...base2, phase: "reveal", results: [] }, "a").yours, true);
assert.match(ts({ ...base2, phase: "reveal" }, "b").headline, /Alice/);
assert.strictEqual(ts({ ...base2, phase: "complete" }, "a").yours, false, "nobody acts once it is over");
ok("host-gated phases point at the host");

assert.strictEqual(listOf(["A"]), "A");
assert.strictEqual(listOf(["A", "B"]), "A and B");
assert.strictEqual(listOf(["A", "B", "C"]), "A, B and C");
assert.strictEqual(listOf(["A", "B", "C", "D"]), "A, B and 2 others");
ok("waiting lists read like a sentence at any length");

console.log(`\nAll ${n} state-machine invariants hold.`);
