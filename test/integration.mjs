/**
 * Integration tests: real HTTP against the real route handlers, backed by a
 * throwaway Postgres.
 *
 * These exist because unit tests missed a schema bug that any real user hit
 * within minutes -- creating a second game from the SAME browser. The pure
 * tests used a fresh cookie per player, so a stable identity across games was
 * never exercised. Anything here runs the code paths a browser actually runs.
 */
import assert from "node:assert";

const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3060";

let passed = 0;
const failures = [];
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failures.push({ name, err });
    console.log(`  FAIL  ${name}\n        ${err.message}`);
  }
}

/** A browser: its own cookie jar, exactly like a separate window. */
function browser() {
  const jar = new Map();
  return {
    async req(path, init = {}) {
      const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
      const res = await fetch(`${BASE}${path}`, {
        ...init,
        headers: {
          ...(init.body ? { "content-type": "application/json" } : {}),
          ...(cookie ? { cookie } : {}),
          ...init.headers,
        },
      });
      for (const sc of res.headers.getSetCookie?.() ?? []) {
        const [pair] = sc.split(";");
        const i = pair.indexOf("=");
        jar.set(pair.slice(0, i), pair.slice(i + 1));
      }
      const text = await res.text();
      let body = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        throw new Error(`non-JSON response from ${path}: ${text.slice(0, 120)}`);
      }
      return { status: res.status, body };
    },
    get(p) {
      return this.req(p);
    },
    post(p, b) {
      return this.req(p, { method: "POST", body: JSON.stringify(b ?? {}) });
    },
  };
}

const create = (b, nickname) => b.post("/api/games", { nickname });

console.log("\n--- lobby and identity ---");

await test("create a game", async () => {
  const a = browser();
  const r = await create(a, "Alice");
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.match(r.body.code, /^[A-Z0-9]{6}$/);
});

// The regression that started all this.
await test("SAME browser can create a second game", async () => {
  const a = browser();
  const first = await create(a, "Alice");
  assert.strictEqual(first.status, 200);
  const second = await create(a, "Alice");
  assert.strictEqual(
    second.status,
    200,
    `second create failed: ${JSON.stringify(second.body)}`,
  );
  assert.notStrictEqual(second.body.code, first.body.code);
});

await test("SAME browser can join a second game after creating one", async () => {
  const a = browser();
  const b = browser();
  await create(a, "Alice");
  const hosted = await create(b, "Bob");
  const joined = await a.post(`/api/games/${hosted.body.code}/join`, { nickname: "Alice" });
  assert.strictEqual(joined.status, 200, JSON.stringify(joined.body));
});

await test("re-joining the same game is idempotent (the reload path)", async () => {
  const a = browser();
  const b = browser();
  const g = await create(a, "Alice");
  const first = await b.post(`/api/games/${g.body.code}/join`, { nickname: "Bob" });
  const again = await b.post(`/api/games/${g.body.code}/join`, { nickname: "Bob" });
  assert.strictEqual(first.status, 200);
  assert.strictEqual(again.status, 200, JSON.stringify(again.body));
  assert.strictEqual(again.body.rejoined, true);
  const s = await a.get(`/api/games/${g.body.code}/state`);
  assert.strictEqual(s.body.players.length, 2, "no duplicate player row");
});

await test("seats are distinct and ordered", async () => {
  const a = browser(), b = browser(), c = browser();
  const g = await create(a, "Alice");
  await b.post(`/api/games/${g.body.code}/join`, { nickname: "Bob" });
  await c.post(`/api/games/${g.body.code}/join`, { nickname: "Cara" });
  const s = await a.get(`/api/games/${g.body.code}/state`);
  assert.deepStrictEqual(s.body.players.map((p) => p.seat), [0, 1, 2]);
});

await test("nickname is required", async () => {
  const a = browser();
  const r = await create(a, "   ");
  assert.strictEqual(r.status, 400);
  assert.ok(r.body.error);
});

await test("unknown game code is a clean 404, not a crash", async () => {
  const a = browser();
  const r = await a.get("/api/games/ZZZZZZ/state");
  assert.strictEqual(r.status, 404);
  assert.ok(r.body.error);
});

console.log("\n--- gate and membership ---");

await test("a stranger sees isPlayer=false (drives the nickname prompt)", async () => {
  const a = browser(), stranger = browser();
  const g = await create(a, "Alice");
  const s = await stranger.get(`/api/games/${g.body.code}/state`);
  assert.strictEqual(s.body.isPlayer, false);
  const mine = await a.get(`/api/games/${g.body.code}/state`);
  assert.strictEqual(mine.body.isPlayer, true);
});

await test("non-member cannot authorise the presence channel", async () => {
  const a = browser(), stranger = browser();
  const g = await create(a, "Alice");
  const res = await fetch(`${BASE}/api/pusher/auth`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: `socket_id=1.2&channel_name=presence-game-${g.body.code}`,
  });
  assert.ok([401, 403].includes(res.status), `expected 401/403, got ${res.status}`);
});

console.log("\n--- game flow ---");

async function twoPlayerGame() {
  const a = browser(), b = browser();
  const g = await create(a, "Alice");
  const code = g.body.code;
  await b.post(`/api/games/${code}/join`, { nickname: "Bob" });
  return { a, b, code };
}

await test("only the host can start, and only with 2+ players", async () => {
  const a = browser(), b = browser();
  const g = await create(a, "Alice");
  const code = g.body.code;
  const tooFew = await a.post(`/api/games/${code}/action`, { type: "start_game" });
  assert.strictEqual(tooFew.status, 400);
  await b.post(`/api/games/${code}/join`, { nickname: "Bob" });
  const notHost = await b.post(`/api/games/${code}/action`, { type: "start_game" });
  assert.strictEqual(notHost.status, 400);
  const ok = await a.post(`/api/games/${code}/action`, { type: "start_game" });
  assert.strictEqual(ok.status, 200, JSON.stringify(ok.body));
});

await test("starting deals each player a private hand", async () => {
  const { a, b, code } = await twoPlayerGame();
  await a.post(`/api/games/${code}/action`, { type: "start_game" });
  const sa = await a.get(`/api/games/${code}/state`);
  const sb = await b.get(`/api/games/${code}/state`);
  assert.strictEqual(sa.body.privateState.hand.length, 5);
  assert.strictEqual(sb.body.privateState.hand.length, 5);
  assert.strictEqual(sa.body.privateState.pending, null);
});

await test("a pick is not visible to the other player before resolution", async () => {
  const { a, b, code } = await twoPlayerGame();
  await a.post(`/api/games/${code}/action`, { type: "start_game" });
  const sa = await a.get(`/api/games/${code}/state`);
  const tile = sa.body.privateState.hand[0];
  await a.post(`/api/games/${code}/commit`, { tile });

  const sb = await b.get(`/api/games/${code}/state`);
  assert.strictEqual(sb.body.state.committed.length, 1, "commit is public");
  // Bob's payload must not contain Alice's tile anywhere outside his own hand.
  const withoutMine = JSON.stringify({ ...sb.body, privateState: null });
  assert.ok(!withoutMine.includes(`"pending":${tile}`), "pick leaked to other player");

  const ev = await b.get(`/api/games/${code}/events?since=0`);
  const raw = JSON.stringify(ev.body);
  assert.ok(!raw.includes("hand"), "hand leaked into the event log");
  assert.ok(!raw.includes("pending"), "pending leaked into the event log");
});

await test("both committing resolves the round", async () => {
  const { a, b, code } = await twoPlayerGame();
  await a.post(`/api/games/${code}/action`, { type: "start_game" });
  const ha = (await a.get(`/api/games/${code}/state`)).body.privateState.hand;
  const hb = (await b.get(`/api/games/${code}/state`)).body.privateState.hand;
  await a.post(`/api/games/${code}/commit`, { tile: ha[0] });
  await b.post(`/api/games/${code}/commit`, { tile: hb.find((t) => t !== ha[0]) ?? hb[0] });

  const s = await a.get(`/api/games/${code}/state`);
  assert.strictEqual(s.body.state.round, 2, "round advanced");
  assert.strictEqual(s.body.state.committed.length, 0, "commits cleared");
  assert.strictEqual(Object.keys(s.body.state.tiles).length, 2, "both tiles claimed");
  assert.strictEqual(s.body.privateState.hand.length, 4, "played card removed");
});

await test("simultaneous identical picks: lower seat wins, no double-claim", async () => {
  const { a, b, code } = await twoPlayerGame();
  await a.post(`/api/games/${code}/action`, { type: "start_game" });
  const ha = (await a.get(`/api/games/${code}/state`)).body.privateState.hand;
  const hb = (await b.get(`/api/games/${code}/state`)).body.privateState.hand;
  const shared = ha.find((t) => hb.includes(t));
  if (shared === undefined) return; // hands did not overlap this run
  await Promise.all([
    a.post(`/api/games/${code}/commit`, { tile: shared }),
    b.post(`/api/games/${code}/commit`, { tile: shared }),
  ]);
  const s = await a.get(`/api/games/${code}/state`);
  const owners = Object.values(s.body.state.tiles);
  assert.strictEqual(new Set(owners).size, owners.length, "a tile was claimed twice");
  assert.strictEqual(s.body.state.tiles[shared], s.body.you, "seat 0 should win the tie");
});

await test("cannot commit a tile that is not in your hand", async () => {
  const { a, code } = await twoPlayerGame();
  await a.post(`/api/games/${code}/action`, { type: "start_game" });
  const hand = (await a.get(`/api/games/${code}/state`)).body.privateState.hand;
  const notMine = [...Array(25).keys()].find((t) => !hand.includes(t));
  const r = await a.post(`/api/games/${code}/commit`, { tile: notMine });
  assert.strictEqual(r.status, 400);
});

await test("cannot join a game already under way", async () => {
  const { a, code } = await twoPlayerGame();
  await a.post(`/api/games/${code}/action`, { type: "start_game" });
  const late = browser();
  const r = await late.post(`/api/games/${code}/join`, { nickname: "Late" });
  assert.strictEqual(r.status, 400);
});

console.log("\n--- event log and sync ---");

await test("seq is gapless from 1", async () => {
  const { a, b, code } = await twoPlayerGame();
  await a.post(`/api/games/${code}/action`, { type: "start_game" });
  const ha = (await a.get(`/api/games/${code}/state`)).body.privateState.hand;
  const hb = (await b.get(`/api/games/${code}/state`)).body.privateState.hand;
  await a.post(`/api/games/${code}/commit`, { tile: ha[0] });
  await b.post(`/api/games/${code}/commit`, { tile: hb.find((t) => t !== ha[0]) ?? hb[0] });
  const ev = await a.get(`/api/games/${code}/events?since=0`);
  const seqs = ev.body.events.map((e) => e.seq);
  assert.deepStrictEqual(seqs, seqs.map((_, i) => i + 1), `gappy seq: ${seqs}`);
});

await test("chat replays from the log after reload", async () => {
  const { a, b, code } = await twoPlayerGame();
  await a.post(`/api/games/${code}/chat`, { text: "hello" });
  const ev = await b.get(`/api/games/${code}/events?since=0`);
  const chat = ev.body.events.filter((e) => e.type === "chat");
  assert.strictEqual(chat.length, 1);
  assert.strictEqual(chat[0].payload.text, "hello");
});

await test("events?since=N returns only newer events", async () => {
  const { a, code } = await twoPlayerGame();
  const all = await a.get(`/api/games/${code}/events?since=0`);
  const last = all.body.events.at(-1).seq;
  const none = await a.get(`/api/games/${code}/events?since=${last}`);
  assert.strictEqual(none.body.events.length, 0);
});

await test("a non-player cannot chat", async () => {
  const { code } = await twoPlayerGame();
  const stranger = browser();
  await stranger.get(`/api/games/${code}/state`); // mint a cookie
  const r = await stranger.post(`/api/games/${code}/chat`, { text: "hi" });
  assert.strictEqual(r.status, 403);
});

console.log("\n--- operations ---");

await test("cleanup requires the cron secret", async () => {
  const r = await fetch(`${BASE}/api/cron/cleanup`);
  assert.strictEqual(r.status, 401);
});

await test("cleanup with the secret succeeds and reports a count", async () => {
  const r = await fetch(`${BASE}/api/cron/cleanup`, {
    headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
  });
  assert.strictEqual(r.status, 200);
  const body = await r.json();
  assert.strictEqual(typeof body.deleted, "number");
});

await test("malformed JSON body is rejected, not crashed on", async () => {
  const res = await fetch(`${BASE}/api/games`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{not json",
  });
  assert.strictEqual(res.status, 400);
  await res.json(); // must still be parseable
});

console.log(
  `\n${failures.length ? "FAILED" : "OK"}  ${passed} passed, ${failures.length} failed\n`,
);
if (failures.length) {
  for (const f of failures) console.error(`  ${f.name}\n    ${f.err.stack}\n`);
  process.exit(1);
}
