// Tests the pure reducer + round resolution: the half of the sync guarantee
// that runs client-side, plus the determinism the game rules depend on.
import assert from "node:assert";
const { reduce, reduceAll, resolveRound, isComplete } =
  await import("../.test-build/reduce.js");
const { initialGameState } = await import("../.test-build/types.js");

const A = "aaa", B = "bbb", C = "ccc";
const seats = { [A]: 0, [B]: 1, [C]: 2 };

const join = (id, seat) => ({ seq: seat + 1, type: "player_joined", payload: { id, nickname: id, seat } });
const base = reduceAll(initialGameState(), [join(A, 0), join(B, 1), join(C, 2)]);
const started = reduce(base, { seq: 4, type: "game_started", payload: { at: "t0" } });

// --- commit visibility -------------------------------------------------
let s = reduce(started, { seq: 5, type: "player_committed", payload: { playerId: A, round: 1 } });
assert.deepStrictEqual(s.committed, [A], "commit is publicly visible");
assert.strictEqual(JSON.stringify(s).includes("hand"), false, "no hand in public state");
console.log("PASS commit is public, pick is not");

s = reduce(s, { seq: 6, type: "player_committed", payload: { playerId: A, round: 1 } });
assert.deepStrictEqual(s.committed, [A], "duplicate commit is idempotent");
console.log("PASS duplicate commit is idempotent");

// --- resolution is deterministic by seat, not arrival order ------------
const picks = [
  { playerId: C, seat: 2, tile: 7 },
  { playerId: A, seat: 0, tile: 7 }, // same tile: lower seat must win
  { playerId: B, seat: 1, tile: 9 },
];
const r1 = resolveRound(started, picks);
const r2 = resolveRound(started, [...picks].reverse()); // different arrival order
assert.deepStrictEqual(r1, r2, "resolution independent of arrival order");
assert.strictEqual(r1.find((p) => p.playerId === A).applied, true, "seat 0 wins the tie");
assert.strictEqual(r1.find((p) => p.playerId === C).applied, false, "seat 2 loses the tie");
assert.strictEqual(r1.find((p) => p.playerId === B).applied, true, "uncontested pick applies");
console.log("PASS resolution deterministic by seat, not by latency");

// --- applying resolution ------------------------------------------------
const resolved = reduce(s, { seq: 7, type: "round_resolved", payload: { round: 1, picks: r1, at: "t1" } });
assert.strictEqual(resolved.tiles[7], A, "winner holds the contested tile");
assert.strictEqual(resolved.scores[A], 1);
assert.strictEqual(resolved.scores[C], 0, "loser scored nothing");
assert.strictEqual(resolved.round, 2, "round advanced");
assert.deepStrictEqual(resolved.committed, [], "commits cleared for next round");
console.log("PASS round resolution applies and advances");

// --- duplicate delivery of a resolution must not double-count ----------
const dup = reduce(resolved, { seq: 7, type: "round_resolved", payload: { round: 1, picks: r1, at: "t1" } });
assert.strictEqual(dup.scores[A], 1, "duplicate resolution did not double-score");
console.log("PASS duplicate resolution is idempotent");

// --- the reload-resume guarantee ---------------------------------------
const evs = [join(A, 0), join(B, 1), join(C, 2),
  { seq: 4, type: "game_started", payload: { at: "t0" } },
  { seq: 5, type: "player_committed", payload: { playerId: A, round: 1 } },
  { seq: 7, type: "round_resolved", payload: { round: 1, picks: r1, at: "t1" } }];
const full = reduceAll(initialGameState(), evs);
const resumed = reduceAll(reduceAll(initialGameState(), evs.slice(0, 4)), evs.slice(4));
assert.deepStrictEqual(resumed, full, "snapshot+tail == full replay");
console.log("PASS snapshot+tail equals full replay (reload-resume)");

// --- chat carries no game state ----------------------------------------
assert.deepStrictEqual(
  reduce(full, { seq: 8, type: "chat", payload: { playerId: A, nickname: "A", text: "hi", at: "t" } }),
  full, "chat is state-neutral");
console.log("PASS chat does not mutate game state");

console.log("\nAll reducer invariants hold.");
