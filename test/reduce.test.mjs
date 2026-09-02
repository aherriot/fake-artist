// Tests the pure reducer: the half of the sync guarantee that runs client-side.
// Game rules are not implemented yet, so this covers the lifecycle events the
// sync layer depends on. Rule-specific cases get added alongside the rules.
import assert from "node:assert";
const { reduce, reduceAll } = await import("../.test-build/reduce.js");
const { initialGameState, normalizeGameState } = await import("../.test-build/types.js");

const A = "aaa", B = "bbb";
const join = (id, seat) => ({ seq: seat + 1, type: "player_joined", payload: { id, nickname: id, seat } });

const lobby = reduceAll(initialGameState(), [join(A, 0), join(B, 1)]);
assert.strictEqual(lobby.round, 0, "lobby has not started");
assert.strictEqual(lobby.startedAt, null);
console.log("PASS joining does not start the game");

const started = reduce(lobby, { seq: 3, type: "game_started", payload: { at: "t0" } });
assert.strictEqual(started.round, 1);
assert.strictEqual(started.startedAt, "t0");
console.log("PASS game_started advances to round 1");

const ended = reduce(started, { seq: 4, type: "game_ended", payload: { at: "t1" } });
assert.strictEqual(ended.endedAt, "t1");
console.log("PASS game_ended records the end");

// Replaying the same event must not compound -- events can arrive twice.
const twice = reduce(started, { seq: 3, type: "game_started", payload: { at: "t0" } });
assert.deepStrictEqual(twice, started, "duplicate delivery is idempotent");
console.log("PASS duplicate delivery is idempotent");

// The reload-resume guarantee: a snapshot plus the tail must equal a full replay.
const evs = [join(A, 0), join(B, 1),
  { seq: 3, type: "game_started", payload: { at: "t0" } },
  { seq: 4, type: "chat", payload: { playerId: A, nickname: "A", text: "hi", at: "t" } }];
const full = reduceAll(initialGameState(), evs);
const resumed = reduceAll(reduceAll(initialGameState(), evs.slice(0, 2)), evs.slice(2));
assert.deepStrictEqual(resumed, full, "snapshot+tail == full replay");
console.log("PASS snapshot+tail equals full replay (reload-resume)");

assert.deepStrictEqual(
  reduce(full, { seq: 5, type: "chat", payload: { playerId: A, nickname: "A", text: "yo", at: "t" } }),
  full, "chat is state-neutral");
console.log("PASS chat does not mutate game state");

// A row written by an older build must degrade, never crash a render.
assert.deepStrictEqual(normalizeGameState(null), initialGameState());
assert.deepStrictEqual(normalizeGameState({}), initialGameState());
assert.strictEqual(normalizeGameState({ round: 3 }).round, 3);
assert.strictEqual(normalizeGameState({ round: "x" }).round, 0, "bad type falls back");
console.log("PASS legacy or partial state normalises to defaults");

console.log("\nAll reducer invariants hold.");
