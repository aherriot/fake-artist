/**
 * Integration tests: real HTTP against the real route handlers, backed by a
 * throwaway Postgres.
 *
 * These exist because unit tests once missed a schema bug that a real user hit
 * within minutes -- creating a second game from the SAME browser. Those tests
 * used a fresh cookie per player, so a stable identity across games was never
 * exercised. Every scenario here uses cookie jars that persist, the way a
 * browser does, and runs the code paths a browser actually runs.
 *
 * Game rules are not implemented yet; this covers lobby, identity, membership,
 * the event log, and operations. Rule tests get added alongside the rules.
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

console.log("\n--- lifecycle ---");

/** A lobby at the real minimum player count. */
async function lobby() {
  const a = browser(), b = browser(), c = browser();
  const g = await create(a, "Alice");
  const code = g.body.code;
  await b.post(`/api/games/${code}/join`, { nickname: "Bob" });
  await c.post(`/api/games/${code}/join`, { nickname: "Cara" });
  return { a, b, c, code };
}

await test("a game below the minimum cannot start", async () => {
  const a = browser(), b = browser();
  const g = await create(a, "Alice");
  await b.post(`/api/games/${g.body.code}/join`, { nickname: "Bob" });
  const r = await a.post(`/api/games/${g.body.code}/action`, { type: "start_match" });
  assert.strictEqual(r.status, 400, "2 players should not be enough by default");
  assert.match(r.body.error, /at least/i);
});

await test("only the host can start", async () => {
  const { a, b, code } = await lobby();
  const notHost = await b.post(`/api/games/${code}/action`, { type: "start_match" });
  assert.strictEqual(notHost.status, 400);
  const ok = await a.post(`/api/games/${code}/action`, { type: "start_match" });
  assert.strictEqual(ok.status, 200, JSON.stringify(ok.body));
});

await test("a started game cannot be started twice", async () => {
  const { a, code } = await lobby();
  await a.post(`/api/games/${code}/action`, { type: "start_match" });
  const again = await a.post(`/api/games/${code}/action`, { type: "start_match" });
  assert.strictEqual(again.status, 400);
});

await test("cannot join a game already under way", async () => {
  const { a, code } = await lobby();
  await a.post(`/api/games/${code}/action`, { type: "start_match" });
  const late = browser();
  const r = await late.post(`/api/games/${code}/join`, { nickname: "Late" });
  assert.strictEqual(r.status, 400);
});

console.log("\n--- a full round ---");

const stroke = () => ({ points: [[0.1, 0.1], [0.5, 0.6], [0.9, 0.2]] });

/** Everyone draws until the drawing phase ends. */
async function drawAll(bs, code) {
  for (let guard = 0; guard < 60; guard++) {
    const s = (await bs[0].get(`/api/games/${code}/state`)).body.state;
    if (s.phase !== "drawing") return s;
    const drawer = s.seatOrder[s.turnIndex % s.seatOrder.length];
    const who = bs.find(async () => true);
    // Find the browser whose player id is the current drawer.
    let actor = null;
    for (const b of bs) {
      const me = (await b.get(`/api/games/${code}/state`)).body;
      if (me.you === drawer) { actor = b; break; }
    }
    assert.ok(actor, "current drawer must be one of the players");
    const r = await actor.post(`/api/games/${code}/stroke`, stroke());
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    void who;
  }
  throw new Error("drawing never ended");
}

async function startedMatch() {
  const { a, b, c, code } = await lobby();
  const r = await a.post(`/api/games/${code}/action`, { type: "start_match" });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  return { a, b, c, bs: [a, b, c], code };
}

await test("starting a match deals exactly one fake artist and hides the topic", async () => {
  const { bs, code } = await startedMatch();
  const privs = [];
  for (const b of bs) privs.push((await b.get(`/api/games/${code}/state`)).body.privateState);
  const fakes = privs.filter((p) => p.role === "fake");
  assert.strictEqual(fakes.length, 1, "exactly one fake artist");
  assert.strictEqual(fakes[0].topic, null, "the fake artist is given no topic");
  const artists = privs.filter((p) => p.role === "artist");
  assert.ok(artists.every((p) => typeof p.topic === "string" && p.topic.length > 0));
  assert.strictEqual(new Set(artists.map((p) => p.topic)).size, 1, "artists share one topic");
});

await test("the category is public but the topic never leaves the database", async () => {
  const { bs, code } = await startedMatch();
  const snaps = [];
  for (const b of bs) snaps.push((await b.get(`/api/games/${code}/state`)).body);
  const topic = snaps.find((s) => s.privateState.topic)?.privateState.topic;
  assert.ok(topic, "an artist has the topic");
  assert.ok(snaps.every((s) => typeof s.state.category === "string"), "category is public");

  // The fake artist's entire payload must not contain the topic anywhere.
  const fakeSnap = snaps.find((s) => s.privateState.role === "fake");
  assert.ok(!JSON.stringify(fakeSnap).includes(topic), "topic leaked to the fake artist");

  // Nor may the event log, which every client receives in full.
  const ev = await bs[0].get(`/api/games/${code}/events?since=0`);
  const raw = JSON.stringify(ev.body);
  assert.ok(!raw.includes(topic), "topic leaked into the event log");
  assert.ok(!raw.includes('"role"'), "roles leaked into the event log");
});

await test("drawing follows seat order for two passes, then the vote opens itself", async () => {
  const { bs, code } = await startedMatch();
  const before = (await bs[0].get(`/api/games/${code}/state`)).body.state;
  assert.strictEqual(before.phase, "drawing");
  const after = await drawAll(bs, code);
  assert.strictEqual(after.phase, "voting", "the last line opens the vote directly");
  assert.strictEqual(after.strokes.length, before.seatOrder.length * 2, "two passes each");
});

await test("a player cannot draw out of turn", async () => {
  const { bs, code } = await startedMatch();
  const s = (await bs[0].get(`/api/games/${code}/state`)).body.state;
  const drawer = s.seatOrder[0];
  for (const b of bs) {
    const me = (await b.get(`/api/games/${code}/state`)).body;
    if (me.you !== drawer) {
      const r = await b.post(`/api/games/${code}/stroke`, stroke());
      assert.strictEqual(r.status, 400, "out-of-turn stroke must be rejected");
      assert.match(r.body.error, /your turn/i);
      return;
    }
  }
});

await test("a malformed stroke is rejected", async () => {
  const { bs, code } = await startedMatch();
  const s = (await bs[0].get(`/api/games/${code}/state`)).body.state;
  const drawer = s.seatOrder[0];
  let actor = null;
  for (const b of bs) {
    const me = (await b.get(`/api/games/${code}/state`)).body;
    if (me.you === drawer) { actor = b; break; }
  }
  for (const bad of [{ points: [[0, 0]] }, { points: [[0, 0], [2, 2]] }, { points: "x" }]) {
    const r = await actor.post(`/api/games/${code}/stroke`, bad);
    assert.strictEqual(r.status, 400, `should reject ${JSON.stringify(bad)}`);
  }
});

await test("votes stay secret until the last one lands", async () => {
  const { bs, code } = await startedMatch();
  await drawAll(bs, code);

  const s0 = (await bs[0].get(`/api/games/${code}/state`)).body;
  assert.strictEqual(s0.state.phase, "voting", "voting opens without anyone pressing Ready");

  // First vote: the fact is public, the choice is not.
  const target = s0.state.seatOrder.find((id) => id !== s0.you);
  await bs[0].post(`/api/games/${code}/vote`, { targetId: target });
  const mid = (await bs[1].get(`/api/games/${code}/state`)).body;
  assert.deepStrictEqual(mid.state.voted, [s0.you], "who has voted is public");
  assert.deepStrictEqual(mid.state.votes, {}, "what they voted is not");

  const ev = await bs[1].get(`/api/games/${code}/events?since=0`);
  const voteEvents = ev.body.events.filter((e) => e.type === "player_voted");
  assert.ok(voteEvents.every((e) => !("targetId" in e.payload)), "ballot leaked into the log");
});

await test("a vote can be changed while the ballot is open, and the change counts", async () => {
  const { bs, code } = await startedMatch();
  await drawAll(bs, code);
  const me = (await bs[0].get(`/api/games/${code}/state`)).body;
  const others = me.state.seatOrder.filter((id) => id !== me.you);

  const first = await bs[0].post(`/api/games/${code}/vote`, { targetId: others[0] });
  assert.strictEqual(first.status, 200, JSON.stringify(first.body));
  const changed = await bs[0].post(`/api/games/${code}/vote`, { targetId: others[1] });
  assert.strictEqual(changed.status, 200, `changing should be allowed: ${JSON.stringify(changed.body)}`);

  // Still counted once: changing your mind is not a second vote.
  const st = (await bs[0].get(`/api/games/${code}/state`)).body.state;
  assert.strictEqual(st.voted.filter((id) => id === me.you).length, 1, "counted once");

  // The other two both accuse the SAME player, so there is a clear plurality.
  // A tie would open a runoff, and a runoff clears state.votes -- which would
  // make this assertion fail for a reason that has nothing to do with changing
  // a vote.
  for (const b of bs.slice(1)) {
    await b.post(`/api/games/${code}/vote`, { targetId: me.you });
  }
  const after = (await bs[0].get(`/api/games/${code}/state`)).body.state;
  assert.notStrictEqual(after.phase, "runoff", "this scenario must not tie");
  assert.strictEqual(after.votes[me.you], others[1], "the changed vote is the one that counted");
  assert.notStrictEqual(after.votes[me.you], others[0], "the original vote was replaced");
});

await test("a player cannot vote for themselves", async () => {
  const { bs, code } = await startedMatch();
  await drawAll(bs, code);
  const me = (await bs[0].get(`/api/games/${code}/state`)).body;
  const other = me.state.seatOrder.find((id) => id !== me.you);

  const self = await bs[0].post(`/api/games/${code}/vote`, { targetId: me.you });
  assert.strictEqual(self.status, 400, "self-vote rejected");
  assert.match(self.body.error, /yourself/i);
  const unknown = await bs[0].post(`/api/games/${code}/vote`, { targetId: "not-a-player" });
  assert.strictEqual(unknown.status, 400, "unknown target rejected");
  void other;
});

await test("a complete round reaches a reveal and scores someone", async () => {
  const { bs, code } = await startedMatch();
  await drawAll(bs, code);

  // Everyone accuses the same player, so there is a clear plurality.
  const s = (await bs[0].get(`/api/games/${code}/state`)).body;
  const accused = s.state.seatOrder[0];
  for (const b of bs) {
    const me = (await b.get(`/api/games/${code}/state`)).body;
    const target = me.you === accused ? s.state.seatOrder[1] : accused;
    const r = await b.post(`/api/games/${code}/vote`, { targetId: target });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  }

  let st = (await bs[0].get(`/api/games/${code}/state`)).body.state;

  // If the room caught the fake artist, they guess and the room judges it.
  if (st.phase === "guess") {
    for (const b of bs) {
      const me = (await b.get(`/api/games/${code}/state`)).body;
      if (me.privateState.role === "fake") {
        const r = await b.post(`/api/games/${code}/guess`, { guess: "definitely wrong" });
        assert.strictEqual(r.status, 200, JSON.stringify(r.body));
      }
    }
    for (const b of bs) {
      const me = (await b.get(`/api/games/${code}/state`)).body;
      if (me.privateState.role !== "fake") {
        await b.post(`/api/games/${code}/guess-vote`, { accept: false });
      }
    }
    st = (await bs[0].get(`/api/games/${code}/state`)).body.state;
  }

  assert.strictEqual(st.phase, "reveal", `expected reveal, got ${st.phase}`);
  assert.strictEqual(st.results.length, 1, "one round recorded");
  const total = Object.values(st.scores).reduce((a, b) => a + b, 0);
  assert.ok(total > 0, "somebody scored");
  assert.strictEqual(st.fakeHistory.length, 1, "the fake artist is recorded at reveal");
});

await test("a tied vote opens a runoff and the runoff can actually be voted in", async () => {
  const { bs, code } = await startedMatch();
  await drawAll(bs, code);

  // Everyone accuses the next player round the table: one vote each, a
  // three-way tie by construction.
  const seats = (await bs[0].get(`/api/games/${code}/state`)).body.state.seatOrder;
  const byId = {};
  for (const b of bs) byId[(await b.get(`/api/games/${code}/state`)).body.you] = b;
  for (let i = 0; i < seats.length; i++) {
    const r = await byId[seats[i]].post(`/api/games/${code}/vote`, {
      targetId: seats[(i + 1) % seats.length],
    });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  }

  let st = (await bs[0].get(`/api/games/${code}/state`)).body.state;
  assert.strictEqual(st.phase, "runoff", "a tie must open a runoff");
  assert.strictEqual(st.runoffCandidates.length, seats.length);
  assert.deepStrictEqual(st.voted, [], "the runoff starts with nobody having voted");

  // The regression: everyone still held their first-round ballot, so every
  // runoff vote was rejected as a duplicate and the round deadlocked here.
  for (let i = 0; i < seats.length; i++) {
    const r = await byId[seats[i]].post(`/api/games/${code}/vote`, {
      targetId: seats[(i + 1) % seats.length],
    });
    assert.strictEqual(r.status, 200, `runoff vote rejected: ${JSON.stringify(r.body)}`);
  }

  st = (await bs[0].get(`/api/games/${code}/state`)).body.state;
  assert.notStrictEqual(st.phase, "runoff", "the round must not be stuck in the runoff");
  assert.ok(["reveal", "guess"].includes(st.phase), `unexpected phase ${st.phase}`);
});

await test("the fake artist cannot judge their own guess", async () => {
  const { bs, code } = await startedMatch();
  await drawAll(bs, code);
  let fake = null;
  for (const b of bs) {
    const me = (await b.get(`/api/games/${code}/state`)).body;
    if (me.privateState.role === "fake") fake = me.you;
  }
  for (const b of bs) {
    const me = (await b.get(`/api/games/${code}/state`)).body;
    const target = me.you === fake ? me.state.seatOrder.find((i) => i !== fake) : fake;
    await b.post(`/api/games/${code}/vote`, { targetId: target });
  }
  const st = (await bs[0].get(`/api/games/${code}/state`)).body.state;
  if (st.phase !== "guess") return; // room failed to convict; nothing to assert
  for (const b of bs) {
    const me = (await b.get(`/api/games/${code}/state`)).body;
    if (me.privateState.role === "fake") {
      await b.post(`/api/games/${code}/guess`, { guess: "x" });
      const r = await b.post(`/api/games/${code}/guess-vote`, { accept: true });
      assert.strictEqual(r.status, 403, "the fake artist must not judge their own guess");
    }
  }
});

await test("the host can end the match early, and only between rounds", async () => {
  const { bs, code } = await startedMatch();
  const [host, other] = bs;

  // Mid-round it must be refused.
  const early = await host.post(`/api/games/${code}/action`, { type: "end_match" });
  assert.strictEqual(early.status, 400, "must not end mid-round");
  assert.match(early.body.error, /between rounds/i);

  // Play a round to the reveal.
  await drawAll(bs, code);
  const seats = (await host.get(`/api/games/${code}/state`)).body.state.seatOrder;
  const byId = {};
  for (const b of bs) byId[(await b.get(`/api/games/${code}/state`)).body.you] = b;
  for (let i = 0; i < seats.length; i++) {
    await byId[seats[i]].post(`/api/games/${code}/vote`, { targetId: seats[(i + 1) % seats.length] });
  }
  // Force it to a reveal whichever branch the vote took.
  let st = (await host.get(`/api/games/${code}/state`)).body.state;
  if (st.phase === "runoff") {
    for (let i = 0; i < seats.length; i++) {
      await byId[seats[i]].post(`/api/games/${code}/vote`, { targetId: seats[(i + 1) % seats.length] });
    }
    st = (await host.get(`/api/games/${code}/state`)).body.state;
  }
  if (st.phase === "guess") {
    for (const b of bs) {
      const me = (await b.get(`/api/games/${code}/state`)).body;
      if (me.privateState.role === "fake") await b.post(`/api/games/${code}/guess`, { guess: "no" });
    }
    for (const b of bs) {
      const me = (await b.get(`/api/games/${code}/state`)).body;
      if (me.privateState.role !== "fake") await b.post(`/api/games/${code}/guess-vote`, { accept: false });
    }
    st = (await host.get(`/api/games/${code}/state`)).body.state;
  }
  assert.strictEqual(st.phase, "reveal", `expected reveal, got ${st.phase}`);

  // A non-host cannot end it.
  const notHost = await other.post(`/api/games/${code}/action`, { type: "end_match" });
  assert.strictEqual(notHost.status, 400, "only the host may end the match");

  const ended = await host.post(`/api/games/${code}/action`, { type: "end_match" });
  assert.strictEqual(ended.status, 200, JSON.stringify(ended.body));

  const final = (await host.get(`/api/games/${code}/state`)).body;
  assert.strictEqual(final.status, "complete", "the game is marked complete");
  assert.strictEqual(final.state.phase, "complete");
  assert.ok(final.state.results.length < final.state.totalRounds, "ended before the full run");
  assert.ok(Object.values(final.state.scores).some((v) => v > 0), "final scores survive");

  // Nothing further can be started.
  const again = await host.post(`/api/games/${code}/action`, { type: "next_round" });
  assert.strictEqual(again.status, 400, "a finished match cannot continue");
});

await test("a player who vanishes mid-vote no longer deadlocks the round", async () => {
  const { bs, code } = await startedMatch();
  await drawAll(bs, code);
  const [host, b2, b3] = bs;
  const hostId = (await host.get(`/api/games/${code}/state`)).body.you;
  const goneId = (await b3.get(`/api/games/${code}/state`)).body.you;

  // Two vote; the third simply stops responding, as a dead phone would.
  for (const b of [host, b2]) {
    const me = (await b.get(`/api/games/${code}/state`)).body;
    await b.post(`/api/games/${code}/vote`, {
      targetId: me.state.seatOrder.find((id) => id !== me.you && id !== goneId),
    });
  }
  let st = (await host.get(`/api/games/${code}/state`)).body.state;
  assert.ok(["voting", "runoff"].includes(st.phase), "still waiting, as expected");
  assert.strictEqual(st.voted.length, 2, "one vote outstanding");

  // A non-host cannot drop anyone.
  const notHost = await b2.post(`/api/games/${code}/action`, {
    type: "drop_player", playerId: goneId,
  });
  assert.strictEqual(notHost.status, 400, "only the host may drop a player");

  const drop = await host.post(`/api/games/${code}/action`, {
    type: "drop_player", playerId: goneId,
  });
  assert.strictEqual(drop.status, 200, JSON.stringify(drop.body));

  st = (await host.get(`/api/games/${code}/state`)).body.state;
  assert.ok(st.absent.includes(goneId), "recorded as dropped");
  assert.notStrictEqual(st.phase, "voting", `the round moved on, got ${st.phase}`);
  assert.ok(["guess", "guess_vote", "reveal", "runoff"].includes(st.phase));
  void hostId;
});

await test("dropping the fake artist voids the round rather than awarding it", async () => {
  const { bs, code } = await startedMatch();
  await drawAll(bs, code);
  const host = bs[0];
  let fakeId = null;
  for (const b of bs) {
    const me = (await b.get(`/api/games/${code}/state`)).body;
    if (me.privateState.role === "fake") fakeId = me.you;
  }
  assert.ok(fakeId, "a fake artist was assigned");
  const before = (await host.get(`/api/games/${code}/state`)).body.state.scores;

  const drop = await host.post(`/api/games/${code}/action`, {
    type: "drop_player", playerId: fakeId,
  });
  assert.strictEqual(drop.status, 200, JSON.stringify(drop.body));

  const st = (await host.get(`/api/games/${code}/state`)).body.state;
  assert.strictEqual(st.phase, "reveal", "the round ends immediately");
  const r = st.results[st.results.length - 1];
  assert.strictEqual(r.voided, true, "marked as abandoned");
  assert.deepStrictEqual(r.winners, [], "nobody wins it");
  assert.deepStrictEqual(st.scores, before, "no score changes hands");
});

await test("a dropped player is back in the next round", async () => {
  const { bs, code } = await startedMatch();
  await drawAll(bs, code);
  const host = bs[0];
  const goneId = (await bs[2].get(`/api/games/${code}/state`)).body.you;
  await host.post(`/api/games/${code}/action`, { type: "drop_player", playerId: goneId });

  // Push through to a reveal however the round resolved.
  for (let i = 0; i < 8; i++) {
    const st = (await host.get(`/api/games/${code}/state`)).body.state;
    if (st.phase === "reveal") break;
    for (const b of bs) {
      const me = (await b.get(`/api/games/${code}/state`)).body;
      const p = me.state.phase;
      if (p === "voting" || p === "runoff") {
        await b.post(`/api/games/${code}/vote`, {
          targetId: me.state.seatOrder.find((id) => id !== me.you),
        });
      } else if (p === "guess" && me.state.accusedId === me.you) {
        await b.post(`/api/games/${code}/guess`, { guess: "no" });
      } else if (p === "guess_vote" && me.privateState.role !== "fake") {
        await b.post(`/api/games/${code}/guess-vote`, { accept: false });
      }
    }
  }
  const before = (await host.get(`/api/games/${code}/state`)).body.state;
  assert.strictEqual(before.phase, "reveal", `expected reveal, got ${before.phase}`);
  assert.ok(before.absent.includes(goneId), "still dropped during the round");

  await host.post(`/api/games/${code}/action`, { type: "next_round" });
  const after = (await host.get(`/api/games/${code}/state`)).body.state;
  assert.deepStrictEqual(after.absent, [], "a new round starts with nobody dropped");
});

console.log("\n--- event log and sync ---");

await test("seq is gapless from 1", async () => {
  const { a, b, code } = await lobby();
  await a.post(`/api/games/${code}/action`, { type: "start_match" });
  await a.post(`/api/games/${code}/chat`, { text: "one" });
  await b.post(`/api/games/${code}/chat`, { text: "two" });
  const ev = await a.get(`/api/games/${code}/events?since=0`);
  const seqs = ev.body.events.map((e) => e.seq);
  assert.ok(seqs.length >= 5, `expected several events, got ${seqs.length}`);
  assert.deepStrictEqual(seqs, seqs.map((_, i) => i + 1), `gappy seq: ${seqs}`);
});

await test("concurrent writers still produce a gapless log", async () => {
  const { a, b, code } = await lobby();
  await Promise.all([
    ...Array.from({ length: 6 }, (_, i) => a.post(`/api/games/${code}/chat`, { text: `a${i}` })),
    ...Array.from({ length: 6 }, (_, i) => b.post(`/api/games/${code}/chat`, { text: `b${i}` })),
  ]);
  const ev = await a.get(`/api/games/${code}/events?since=0`);
  const seqs = ev.body.events.map((e) => e.seq);
  assert.deepStrictEqual(seqs, seqs.map((_, i) => i + 1), `gappy seq under concurrency: ${seqs}`);
  assert.strictEqual(new Set(seqs).size, seqs.length, "duplicate seq allocated");
});

await test("chat replays from the log after reload", async () => {
  const { a, b, code } = await lobby();
  await a.post(`/api/games/${code}/chat`, { text: "hello" });
  const ev = await b.get(`/api/games/${code}/events?since=0`);
  const chat = ev.body.events.filter((e) => e.type === "chat");
  assert.strictEqual(chat.length, 1);
  assert.strictEqual(chat[0].payload.text, "hello");
});

await test("events?since=N returns only newer events", async () => {
  const { a, code } = await lobby();
  const all = await a.get(`/api/games/${code}/events?since=0`);
  const last = all.body.events.at(-1).seq;
  const none = await a.get(`/api/games/${code}/events?since=${last}`);
  assert.strictEqual(none.body.events.length, 0);
});

await test("a non-player cannot chat", async () => {
  const { code } = await lobby();
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
