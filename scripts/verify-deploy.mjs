/**
 * Production smoke test.  Usage:  node scripts/verify-deploy.mjs <url>
 *
 * Exists because the ways a deployment of this app breaks are mostly SILENT:
 *
 *  - NEXT_PUBLIC_* variables are inlined at BUILD time. If the Pusher key was
 *    not set in Vercel before the build ran, the app does not error -- it
 *    quietly falls back to 2-second polling. Everything works, just slowly and
 *    at needless database cost, and nothing in the logs says so.
 *  - A production database that never had `db:push` run against it fails only
 *    on the first click.
 *  - An unset CRON_SECRET makes the cleanup job 500 forever, unnoticed until
 *    old games pile up.
 *
 * Plays a real round, so it leaves one finished game behind. The cleanup cron
 * removes it within 24 hours; players are named so you can spot them.
 */
const base = (process.argv[2] ?? "").replace(/\/$/, "");
if (!base) {
  console.error("usage: node scripts/verify-deploy.mjs https://your-app.vercel.app");
  process.exit(2);
}

let pass = 0;
const fails = [];
const check = async (name, fn) => {
  try {
    const note = await fn();
    pass++;
    console.log(`  PASS  ${name}${note ? ` — ${note}` : ""}`);
  } catch (e) {
    fails.push(name);
    console.log(`  FAIL  ${name}\n        ${e.message}`);
  }
};
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

function browser() {
  const jar = new Map();
  return {
    async req(path, init = {}) {
      const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
      const res = await fetch(base + path, {
        ...init,
        headers: {
          ...(init.body ? { "content-type": "application/json" } : {}),
          ...(cookie ? { cookie } : {}), ...init.headers,
        },
      });
      for (const sc of res.headers.getSetCookie?.() ?? []) {
        const [p] = sc.split(";"); const i = p.indexOf("=");
        jar.set(p.slice(0, i), p.slice(i + 1));
      }
      const text = await res.text();
      let body = null;
      try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text.slice(0, 200) }; }
      return { status: res.status, body, headers: res.headers };
    },
    get(p) { return this.req(p); },
    post(p, b) { return this.req(p, { method: "POST", body: JSON.stringify(b ?? {}) }); },
  };
}

console.log(`\nVerifying ${base}\n`);
const a = browser(), b = browser(), c = browser();
let code = null;

await check("the site is up", async () => {
  const r = await fetch(base + "/");
  assert(r.ok, `GET / returned ${r.status}`);
  return `served from ${r.headers.get("x-vercel-id")?.split("::")[0] ?? "?"}`;
});

await check("database is reachable and has a schema", async () => {
  const r = await a.post("/api/games", { nickname: "smoke-alice" });
  assert(r.status !== 503 || !/schema/i.test(r.body?.error ?? ""),
    "the production database has no schema — run `npm run db:push` against the production DATABASE_URL");
  assert(r.status === 200, `POST /api/games returned ${r.status}: ${JSON.stringify(r.body)}`);
  code = r.body.code;
  return `created ${code}`;
});

await check("a second player can join", async () => {
  const r = await b.post(`/api/games/${code}/join`, { nickname: "smoke-bob" });
  assert(r.status === 200, JSON.stringify(r.body));
  const r2 = await c.post(`/api/games/${code}/join`, { nickname: "smoke-cara" });
  assert(r2.status === 200, JSON.stringify(r2.body));
});

await check("presence auth works (server Pusher credentials are set)", async () => {
  const r = await a.req("/api/pusher/auth", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: `socket_id=1.2&channel_name=presence-game-${code}`,
  });
  assert(r.status === 200,
    `pusher auth returned ${r.status} — check PUSHER_APP_ID / PUSHER_SECRET / NEXT_PUBLIC_PUSHER_KEY in Vercel`);
});

await check("the match starts and deals one fake artist", async () => {
  const s0 = await a.post(`/api/games/${code}/action`, { type: "start_match" });
  assert(s0.status === 200, `start: ${JSON.stringify(s0.body)}`);
  const privs = [];
  for (const x of [a, b, c]) privs.push((await x.get(`/api/games/${code}/state`)).body.privateState);
  const fakes = privs.filter((p) => p?.role === "fake");
  assert(fakes.length === 1, `expected exactly one fake artist, got ${fakes.length}`);
  assert(fakes[0].topic === null, "the fake artist was given the topic");
});

// Checked DURING the round. After the reveal the topic is public by design, so
// asserting it is hidden at that point tests nothing.
await check("secrets never leave the database (mid-round)", async () => {
  const snaps = [];
  for (const x of [a, b, c]) snaps.push((await x.get(`/api/games/${code}/state`)).body);
  const topic = snaps.find((s) => s.privateState?.topic)?.privateState.topic;
  assert(topic, "no artist holds a topic");
  const fake = snaps.find((s) => s.privateState?.role === "fake");
  assert(!JSON.stringify(fake).includes(topic), "the topic leaked to the fake artist");
  const ev = await a.get(`/api/games/${code}/events?since=0`);
  const raw = JSON.stringify(ev.body.events);
  assert(!raw.includes(topic), "the topic leaked into the event log");
  assert(!raw.includes('"role"'), "roles leaked into the event log");
  return "topic hidden from the fake artist and the log";
});

await check("realtime is configured (NOT silently polling)", async () => {
  // NEXT_PUBLIC_* is inlined at BUILD time, and only into the bundles that
  // reference it -- pusher-client is imported by the game page, so that is the
  // chunk to scan. The home page will never contain the key.
  const html = await (await fetch(`${base}/game/${code}`, {
    headers: { cookie: "x=1" },
  })).text();
  const chunks = [...html.matchAll(/(\/_next\/static\/[^"']+\.js)/g)].map((m) => m[1]);
  assert(chunks.length > 0, "no client chunks found on the game page");
  let found = false;
  for (const ch of [...new Set(chunks)]) {
    const js = await (await fetch(base + ch)).text();
    if (/pusher/i.test(js) && /["'][a-f0-9]{20}["']/.test(js)) { found = true; break; }
  }
  assert(found,
    "no Pusher key in the game page bundle — NEXT_PUBLIC_PUSHER_KEY was not set AT BUILD TIME, so every client silently falls back to polling. Set it in Vercel and REDEPLOY: changing the variable alone does nothing, the build must re-run.");
});

await check("a full round plays through", async () => {
  const bs = [a, b, c];
  const ids = {};
  for (const x of bs) ids[(await x.get(`/api/games/${code}/state`)).body.you] = x;

  for (let i = 0; i < 20; i++) {
    const st = (await a.get(`/api/games/${code}/state`)).body.state;
    if (st.phase !== "drawing") break;
    const who = st.seatOrder[st.turnIndex % st.seatOrder.length];
    const r = await ids[who].post(`/api/games/${code}/stroke`,
      { points: [[0.2, 0.7], [0.5, 0.3], [0.8, 0.6]] });
    assert(r.status === 200, `stroke: ${JSON.stringify(r.body)}`);
  }
  for (const x of bs) await x.post(`/api/games/${code}/action`, { type: "ready" });
  await a.post(`/api/games/${code}/action`, { type: "open_voting" });

  const snap = await a.get(`/api/games/${code}/state`);
  const seats = snap.body.state.seatOrder;
  for (const x of bs) {
    const me = (await x.get(`/api/games/${code}/state`)).body.you;
    const target = seats.find((s) => s !== me);
    const r = await x.post(`/api/games/${code}/vote`, { targetId: target });
    assert(r.status === 200, `vote: ${JSON.stringify(r.body)}`);
  }
  const st = (await a.get(`/api/games/${code}/state`)).body.state;
  assert(["guess", "reveal", "runoff"].includes(st.phase), `unexpected phase ${st.phase}`);
  return `reached ${st.phase}`;
});

await check("the cleanup cron is guarded (CRON_SECRET is set)", async () => {
  const r = await fetch(base + "/api/cron/cleanup");
  assert(r.status !== 500,
    "cleanup returned 500 — CRON_SECRET is not set in Vercel, so old games will never be removed");
  assert(r.status === 401, `expected 401 without the secret, got ${r.status}`);
});

await check("unknown routes and codes fail cleanly", async () => {
  const r = await a.get("/api/games/ZZZZZZ/state");
  assert(r.status === 404, `expected 404, got ${r.status}`);
  assert(r.body?.error, "404 carried no JSON error body");
});

console.log(`\n${fails.length ? "FAILED" : "OK"}  ${pass} passed, ${fails.length} failed`);
if (code) console.log(`\nLeft one finished game behind: ${code} (players named smoke-*)`);
process.exit(fails.length ? 1 : 0);
