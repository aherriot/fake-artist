// Pure state-machine tests: the half of the sync guarantee that runs
// client-side, and the rules the server validates against.
import assert from "node:assert";
const { reduce, reduceAll, tally, settleRound, validateStroke, validateVote, validateAction } =
  await import("../.test-build/game/reduce.js");
const { initialGameState, normalizeGameState, currentDrawer, currentPass } =
  await import("../.test-build/game/types.js");

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
assert.strictEqual(d.phase, "voting", "the last line opens the vote directly");
assert.deepStrictEqual(d.voted, [], "the ballot starts empty");
assert.strictEqual(d.strokes.length, 6);
ok("two passes in fixed seat order, then the vote opens itself");

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

// A skipped LAST turn must open the vote just as a drawn one does.
let skipAll = s;
for (let i = 0; i < 6; i++) skipAll = reduce(skipAll, { seq: 200 + i, type: "turn_skipped", payload: { playerId: A } });
assert.strictEqual(skipAll.phase, "voting", "skipping the final turn still opens the vote");
ok("skipping the final turn opens the vote");


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
assert.deepStrictEqual(rev.fakeHistory, [C], "fake recorded only at reveal");
assert.deepStrictEqual(rev.usedTopics, ["Tomato"]);
assert.strictEqual(rev.results.length, 1);
assert.strictEqual(rev.results[0].scores, undefined, "scores are not duplicated into the result");
const revDup = reduce(rev, { seq: 80, type: "round_revealed", payload: result });
assert.deepStrictEqual(revDup.fakeHistory, [C], "duplicate reveal does not double-record");
// The history is a log, not a set: the same player may fake again later.
const later = reduce(rev, {
  seq: 81, type: "round_revealed",
  payload: { ...result, round: 2, topic: "Kettle", scores: { a: 0, b: 0, c: 2 } },
});
assert.deepStrictEqual(later.fakeHistory, [C, C], "a repeat fake is recorded again");
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
assert.strictEqual(validateVote(B, { state: voting, playerId: A }).ok, true);
assert.strictEqual(validateVote(A, { state: voting, playerId: A }).ok, false, "no self-vote");
// Changing your mind is allowed while the ballot is open: nothing is revealed
// until every vote is in, so a misclick must not decide the round.
assert.strictEqual(validateVote(C, { state: voting, playerId: A }).ok, true, "a vote may be changed");
assert.strictEqual(validateVote("zz", { state: voting, playerId: A }).ok, false, "unknown player");
// `s` is mid-drawing: the ballot is not open yet.
assert.strictEqual(validateVote(B, { state: s, playerId: A }).ok, false, "voting not open during drawing");
const runoff = { ...voting, phase: "runoff", runoffCandidates: [A, B] };
assert.strictEqual(validateVote(C, { state: runoff, playerId: A }).ok, false, "runoff is limited to tied players");
ok("vote validation enforces phase, self-vote and the runoff set, and allows changes");

const hostCtx = { state: d, status: "active", playerId: A, hostId: A, playerCount: 3 };
assert.strictEqual(validateAction({ type: "skip_turn" }, hostCtx).ok, false, "cannot skip outside drawing");
const drawingCtx = { ...hostCtx, state: s };
assert.strictEqual(validateAction({ type: "skip_turn" }, drawingCtx).ok, true, "host may skip while drawing");
assert.strictEqual(
  validateAction({ type: "skip_turn" }, { ...drawingCtx, playerId: B }).ok, false, "host only");
assert.strictEqual(validateAction({ type: "open_voting" }, hostCtx).ok, false, "open_voting no longer exists");

// Ending early: host only, and only between rounds.
const revealCtx = { ...hostCtx, state: { ...d, phase: "reveal" } };
assert.strictEqual(validateAction({ type: "end_match" }, revealCtx).ok, true, "host may end at a reveal");
assert.strictEqual(
  validateAction({ type: "end_match" }, { ...revealCtx, playerId: B }).ok, false, "host only");
assert.strictEqual(
  validateAction({ type: "end_match" }, drawingCtx).ok, false, "cannot end mid-round");
assert.match(
  validateAction({ type: "end_match" }, drawingCtx).error, /between rounds/i);
assert.strictEqual(validateAction({ type: "ready" }, hostCtx).ok, false, "ready no longer exists");
ok("action validation enforces host-only and phase");

// --- legacy rows degrade rather than crash ---------------------------------
assert.deepStrictEqual(normalizeGameState(null), initialGameState());
assert.deepStrictEqual(normalizeGameState({ strokes: "bad", scores: [] }).strokes, []);
assert.strictEqual(normalizeGameState({ round: "x" }).round, 0);
ok("legacy or partial state normalises to defaults");


// --- optimistic reconciliation ---------------------------------------------
const { emptyPending, reconcile, hasVoted, clearForNewRound, mergedStrokes } =
  await import("../.test-build/game/optimistic.js");

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

// A predicted vote clears once public state shows it landed.
let p2 = { ...emptyPending(), voted: true };
const st2 = { ...initialGameState(), voted: [you] };
assert.strictEqual(reconcile(p2, st2, you, []).voted, false, "retired once confirmed");
assert.strictEqual(hasVoted(initialGameState(), p2, you), true, "prediction shows before confirmation");
assert.strictEqual(hasVoted(st2, emptyPending(), you), true, "confirmation shows without prediction");
ok("a voted prediction merges with its confirmation");

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
const p5 = { chat: [{ nonce: "x", playerId: you, nickname: "A", text: "t", at: "t" }], strokes: [mine], voted: true };
const cleared = clearForNewRound(p5);
assert.strictEqual(cleared.strokes.length, 0);
assert.strictEqual(cleared.voted, false);
assert.strictEqual(cleared.chat.length, 1, "chat spans rounds");
ok("a new round clears per-round predictions but keeps chat");


// --- the word list ----------------------------------------------------------
const { CATEGORIES, WORD_PAIRS, pickPair, MIN_TOPICS_PER_CATEGORY } =
  await import("../.test-build/game/words.js");

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
const { turnStatus, headlineText, nameList } = await import("../.test-build/game/status.js");

const P = [
  { id: "a", nickname: "Alice", seat: 0 },
  { id: "b", nickname: "Bob", seat: 1 },
  { id: "c", nickname: "Cara", seat: 2 },
];
const base2 = { ...initialGameState(), seatOrder: ["a", "b", "c"], round: 1, totalRounds: 3 };
const ts = (state, you, extra = {}) =>
  turnStatus({ state, you, hostId: "a", players: P, privateState: null, ...extra });
/** Headlines are segments now, so names can be coloured; flatten to assert. */
const hl = (state, you, extra = {}) => headlineText(ts(state, you, extra).headline, P);

// The single most important bit: does the viewer have to act?
assert.strictEqual(ts({ ...base2, phase: "drawing", turnIndex: 0 }, "a").yours, true);
assert.strictEqual(ts({ ...base2, phase: "drawing", turnIndex: 0 }, "b").yours, false);
assert.match(hl({ ...base2, phase: "drawing", turnIndex: 0 }, "b"), /Alice/);
assert.match(hl({ ...base2, phase: "drawing", turnIndex: 1 }, "b"), /Your turn/);
ok("drawing says whose turn it is, from either side");


// Optimistic flags stop the board flickering back to "your move".
const vote = { ...base2, phase: "voting", voted: [] };
assert.strictEqual(ts(vote, "a", { voted: true }).yours, false, "optimistic vote counts");
ok("an optimistic vote is respected");

// Only the accused guesses; only the others judge it.
const guess = { ...base2, phase: "guess", accusedId: "c" };
assert.strictEqual(ts(guess, "c").yours, true);
assert.match(hl(guess, "a"), /Cara/);
const gv = { ...base2, phase: "guess_vote", accusedId: "c", guessVoted: [] };
assert.strictEqual(ts(gv, "c", { privateState: { role: "fake" } }).yours, false,
  "the fake artist never judges their own guess");
assert.strictEqual(ts(gv, "a", { privateState: { role: "artist" } }).yours, true);
ok("the guess and its judgement go to the right people");

// Host-gated phases.
assert.strictEqual(ts({ ...base2, phase: "lobby" }, "a").yours, true, "host starts");
assert.strictEqual(ts({ ...base2, phase: "lobby" }, "b").yours, false);
assert.strictEqual(ts({ ...base2, phase: "reveal", results: [] }, "a").yours, true);
assert.match(hl({ ...base2, phase: "reveal" }, "b"), /Alice/);
assert.strictEqual(ts({ ...base2, phase: "complete" }, "a").yours, false, "nobody acts once it is over");
ok("host-gated phases point at the host");

const L = (ids) => headlineText(nameList(ids), P);
assert.strictEqual(L(["a"]), "Alice");
assert.strictEqual(L(["a", "b"]), "Alice and Bob");
assert.strictEqual(L(["a", "b", "c"]), "Alice, Bob and Cara");
assert.strictEqual(L(["a", "b", "c", "d"]), "Alice, Bob, Cara and 1 other");
ok("waiting lists read like a sentence at any length");

// Names must survive as segments, not be flattened into the sentence, or the
// UI cannot colour them.
const waiting = ts({ ...base2, phase: "drawing", turnIndex: 0 }, "b");
assert.ok(waiting.headline.some((x) => typeof x === "object" && x.player === "a"),
  "the waited-on player is a segment, not baked into the string");
assert.deepStrictEqual(waiting.waitingOn, ["a"], "waitingOn carries ids, not nicknames");
ok("headlines keep player references addressable so they can be coloured");


// --- remembered nickname ----------------------------------------------------
const rn = await import("../.test-build/ui/rememberedName.js");

const fakeStore = () => {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    _map: m,
  };
};
globalThis.window = { localStorage: fakeStore() };

assert.strictEqual(rn.loadNickname(), "", "nothing remembered to begin with");
rn.saveNickname("  Hopper  ");
assert.strictEqual(rn.loadNickname(), "Hopper", "trimmed on the way in");
rn.saveNickname("x".repeat(200));
assert.strictEqual(rn.loadNickname().length, rn.MAX_NAME, "clamped to the field limit");
rn.saveNickname("   ");
assert.strictEqual(rn.loadNickname().length, rn.MAX_NAME, "a blank name does not erase the old one");
rn.forgetNickname();
assert.strictEqual(rn.loadNickname(), "", "forgotten on request");
ok("remembered nickname round-trips, trimmed and clamped");

// The case that matters: private windows and blocked site data do not merely
// return null, they THROW on access. An unguarded read would take the page down.
globalThis.window = {
  get localStorage() {
    throw new DOMException("The operation is insecure.", "SecurityError");
  },
};
assert.strictEqual(rn.loadNickname(), "", "throwing storage reads as 'nothing remembered'");
assert.doesNotThrow(() => rn.saveNickname("Hopper"), "saving must never throw");
assert.doesNotThrow(() => rn.forgetNickname(), "forgetting must never throw");
ok("storage that throws degrades quietly instead of breaking the page");

// Server-side rendering has no window at all.
delete globalThis.window;
assert.strictEqual(rn.loadNickname(), "", "no window on the server");
assert.doesNotThrow(() => rn.saveNickname("Hopper"));
ok("no window on the server is handled");


// --- who is the fake artist -------------------------------------------------
const { pickFakeArtist, shuffle: shuf } = await import("../.test-build/game/selection.js");

// Sample the REAL distribution rather than reasoning about it. The property
// that matters is that no history ever makes the next fake artist a safe bet.
function distribution(seats, history, samples = 4000) {
  const t = new Map(seats.map((s) => [s, 0]));
  for (let i = 0; i < samples; i++) t.set(pickFakeArtist(seats, history), t.get(pickFakeArtist(seats, history)) ?? 0);
  for (const s of seats) t.set(s, 0);
  for (let i = 0; i < samples; i++) { const c = pickFakeArtist(seats, history); t.set(c, t.get(c) + 1); }
  return t;
}
const seats6 = ["a", "b", "c", "d", "e", "f"];

// The exact case the old rule broke on: five have faked, one has not. Under
// "everyone exactly once" this was a certainty.
const nearlyDone = ["a", "b", "c", "d", "e"];
const d1 = distribution(seats6, nearlyDone);
const best = Math.max(...d1.values()) / 4000;
assert.ok(best < 0.45, `last round should not be a safe bet, best guess was ${(best * 100).toFixed(0)}%`);
assert.ok((d1.get("f") ?? 0) > 0, "the player who has not faked is still likely");
assert.ok([...d1.values()].filter((v) => v > 0).length >= 4, "several candidates remain live");
ok("the final round is never a certainty");

// Never the same player twice running.
const d2 = distribution(seats6, ["c"]);
assert.strictEqual(d2.get("c"), 0, "the previous fake artist cannot be picked again");
ok("never the same fake artist twice running");

// Still biased towards whoever has faked least.
const d3 = distribution(seats6, ["a", "a", "a", "b"]);
assert.ok((d3.get("c") ?? 0) > (d3.get("a") ?? 0), "someone who has never faked beats a repeat offender");
ok("selection favours whoever has faked least");

// Degenerate inputs must not throw.
assert.strictEqual(pickFakeArtist(["solo"], []), "solo");
assert.strictEqual(pickFakeArtist(["solo"], ["solo"]), "solo", "one player, nobody else to pick");
assert.ok(["a", "b"].includes(pickFakeArtist(["a", "b"], ["a"])));
assert.throws(() => pickFakeArtist([], []), /no players/);
ok("degenerate player counts are handled");

// shuffle keeps everyone exactly once.
const sh = shuf(seats6);
assert.deepStrictEqual([...sh].sort(), [...seats6].sort(), "shuffle preserves the players");
ok("seat shuffle preserves every player");

console.log(`\nAll ${n} state-machine invariants hold.`);
