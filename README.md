# Multiplayer POC — Next.js + Vercel + Neon + Pusher

A hosting/architecture proof of concept for an online multiplayer game. It is
**not** RoboRally, but it is RoboRally-*shaped*: each round every player secretly
picks a tile from a private hand, then the server reveals all picks at once and
resolves them in seat order. That is the pattern — simultaneous secret commits,
deterministic resolution — that the storage and sync layers actually have to
survive. The UI is deliberately unstyled; this is a test harness, so the sync
internals *are* the interface.

## What it proves

| Question | How it's answered |
|---|---|
| Lobby + join in realtime | Pusher presence channel, keyed by join code |
| Shared state stays in sync | Postgres event log + per-client `seq` cursor |
| Reload resumes the game | Signed cookie identity + snapshot refetch |
| Survives autoscaling | Zero server memory; every instance is interchangeable |
| Works across the world | Functions pinned to the Neon region; Pusher edge fan-out |
| Old games get cleaned up | Vercel Cron with three staleness rules + cascade |
| Secrets stay secret | Private state in per-player rows, never in the event log |
| Simultaneous commits don't contend | Each player writes only their own row |

## The core idea

**Neon is the source of truth. Pusher is only a notification hint.**

Every mutation is one transaction that updates state *and* appends to a per-game
event log with a gapless `seq`. Clients hold a cursor. Pusher pushes events; if a
client ever sees a gap it refetches from the DB and heals itself.

```
POST /api/games/CODE/action
        │
        ▼
  ┌─────────────────────────────┐
  │ 1. validate (inside the tx) │
  │ 2. UPDATE … WHERE version=N │──► Neon  ◄── source of truth
  │ 3. INSERT event (seq = N+1) │
  │ 4. COMMIT                   │
  │ 5. broadcast  ← after commit│
  └──────────────┬──────────────┘
                 ▼
          Pusher presence-game-CODE
        ┌────────┼────────┐
        ▼        ▼        ▼
    seq=N+1  seq=N+1   gap! ──► GET /events?since=N
```

One rule covers dropped messages, duplicates, reordering, reconnects, and
reloads, with no special cases:

```
seq == lastSeq + 1  → apply
seq >  lastSeq + 1  → gap, refetch from DB
seq <= lastSeq      → duplicate, ignore
```

### Public vs private state

Two stores, split along the secrecy boundary — which turns out to be the same
line as the contention boundary:

| | `games.state` (jsonb) | `player_state` (row per player) |
|---|---|---|
| holds | board, scores, round | hand, pending pick |
| visibility | everyone | only its owner |
| written | once per round, at resolution | once per commit, by one player |

A player's pick **never enters the event log**. Committing appends only
`player_committed` — which reveals *that* someone chose, not *what*. Picks
become public in `round_resolved`, because by then they are. Every payload in
the log is public by construction, so no broadcast can leak.

`state.committed` is **derived**, not stored: persisting it would mean writing
the shared row on every commit, which is exactly the contention this split
removes. The snapshot computes it from `player_state`, selecting only ids.

### Three decisions worth knowing

- **Subscribe before fetching the snapshot.** `useGameSync` binds the channel and
  *buffers* before requesting state, then drains the buffer discarding anything
  `<= lastSeq`. Doing it the other way round silently drops any event that fires
  while the snapshot request is in flight.
- **Channels are keyed by join code, not game id.** The client knows the code
  from the URL, so it can subscribe before it knows the game id. Keying by id
  would force fetch-then-subscribe and reopen that race.
- **Broadcast only after COMMIT.** Triggering inside the transaction can publish
  an event for a rollback that never happened, leaving clients pinned to a `seq`
  that does not exist. `broadcast()` also never throws — Pusher being down must
  not fail an already-committed write, and clients self-heal anyway.
- **One advisory lock per game, per commit.** Without it two players committing
  at the same instant can each read the other as not-yet-committed, both
  conclude they are not last, and leave the round unresolved forever. The lock
  is per-game and costs a short wait, not a jsonb rewrite.
- **`seq` allocation uses `ON CONFLICT DO NOTHING`.** Writers on *different*
  rows can compute the same `MAX(seq)+1`. Raising a unique violation would
  abort the whole transaction; returning zero rows lets us retry the allocation
  inside it. The unique index on `(game_id, seq)` makes this safe, not lucky.

## Setup

1. **Neon** — create a project, copy the **pooled** connection string (host
   contains `-pooler`). The pooled endpoint is what lets many autoscaled
   instances share a few real Postgres backends.
2. **Pusher** — create a Channels app (free Sandbox: 100 connections,
   200k msgs/day). Note app id, key, secret, cluster.
3. `cp .env.example .env.local` and fill it in. Generate secrets with
   `openssl rand -base64 32`.
4. `npm install && npm run db:push`
5. `npm run dev`

### Region pinning

`preferredRegion` is a literal in each `app/api/**/route.ts` — Next.js silently
ignores it if re-exported from a shared module. Set every route to the Vercel
region matching your Neon region:

```bash
grep -rl 'preferredRegion' app | xargs sed -i '' 's/"iad1"/"fra1"/'
```

Without this a player in Sydney pays the trans-Pacific round trip **twice** per
action (client→function, function→DB) instead of once.

## Deploy

Push to a repo, import into Vercel, set the env vars from `.env.example`
(`CRON_SECRET` too — Vercel injects it into cron requests automatically).
`vercel.json` registers the daily cleanup job. Cron requires a Pro plan for
sub-daily schedules; daily works on Hobby.

## When things break

Failure is a first-class state here, not an afterthought. Every path ends in a
plain-language message and a next action.

| Failure | What the user sees |
|---|---|
| Component throws | `app/error.tsx` — "Something went wrong", Try again / Reload / Home |
| Root layout throws | `app/global-error.tsx` — dependency-free last resort |
| Stale bundle after deploy | "A new version is available" + Reload (`reset()` cannot fix a missing chunk) |
| Bad game code | "No game with that code", plus the code alphabet as a hint |
| Network blip loading a game | Retried twice with backoff, then Try again |
| Unknown URL | `app/not-found.tsx` |
| API throws | `apiHandler` returns JSON + a `requestId` echoed in the UI and the server log |
| Pusher down or unconfigured | Silently degrades to 2s polling; the game stays playable |
| Legacy/partial game row | `normalizeGameState` fills defaults instead of crashing a render |

Two rules the code enforces: the client never calls `JSON.parse` on an
unchecked body (`lib/fetch-json.ts` cannot throw), and no route can return an
empty body (`lib/api.ts` wraps every handler). Together they make
"unexpected end of data" unreachable.

## Verification

`npm test` covers the pure reducer. The rest is manual — open two browsers, one
normal and one incognito, so they get distinct cookies.

- [ ] 1. Create in A, join by code in B → B appears in A's roster in ~200ms
- [ ] 2. Start the game as host; non-host sees the board activate
- [ ] 3. Both players commit a pick → round resolves, both boards converge
- [ ] 4. **Reload B** mid-game → same state, chat history intact, still live
- [ ] 4b. **Shared link:** paste `/game/CODE` into a third browser → it prompts
        for a nickname, joins, and appears in A's roster. After the game starts,
        a new browser is told it cannot join rather than being asked to type
- [ ] 5. DevTools → Network → Offline on B for 20s, act in A, go back online →
        B's `resyncs` counter ticks and it catches up (this is the money test)
- [ ] 6. Click "force resync" → `lastSeq` drops to 0 and rebuilds to match A
- [ ] 7. Both players commit the **same** tile → lower seat wins, other's pick
        is marked not applied. Rerun: same outcome regardless of who clicked first
- [ ] 7b. **Secrecy:** with B's DevTools open, commit a pick in A. Confirm no
        network payload or Pusher frame in B contains A's tile — only
        `player_committed`. It appears in B only at `round_resolved`
- [ ] 8. Deploy and repeat 1–7 against the live URL
- [ ] 9. Have someone on another continent join → confirm playable latency
- [ ] 10. `curl -H "Authorization: Bearer $CRON_SECRET" $URL/api/cron/cleanup`
         then check `/debug` — stale games gone, active ones untouched
- [ ] 11. Visit `/game/ZZZZZZ` → "No game with that code", not a crash
- [ ] 12. Stop the dev server mid-game → the tab reports a reachable error with
         Try again, and recovers on its own once the server is back

The `/debug` page lists every game with its status, player count, `lastSeq`, and
idle time, refreshing every 3s. The in-game debug strip shows connection state,
`lastSeq`, resync count, and online/total.

### Already verified locally

Run against throwaway Postgres 18 clusters during development.

**Concurrency and ordering**
- **40 rounds × 6 players committing simultaneously** (240 concurrent commits)
  → exactly 40 resolutions, one per round. No double-resolution, no stalls,
  zero stuck pending rows.
- `seq` **gapless and unique** across all 280 events, despite concurrent writers
  on *different* rows relying on `ON CONFLICT DO NOTHING` rather than a lock.
- Cleanup deleted exactly the complete/stale-lobby/abandoned games, left active
  and recent ones alone, and cascaded orphaned players and events.

**Retry behaviour under contention** (single shared row, 10KB state)

| writers | tps | latency | retries/write | gave up |
|---|---|---|---|---|
| 8 | 171 | 47 ms | 1.00 | 0 |
| 32 | 134 | 240 ms | 1.01 | 0 |
| 64 | 103 | 621 ms | 1.05 | 0 |

Retries stay flat even at 64-way contention — writers *queue on the row lock*
rather than spinning, so there is no livelock. But the tail matters: 0.55% of
writes needed 3–4 retries, so the original cap of 2 produced spurious 409s.
Hence `MAX_ATTEMPTS = 5` with full jitter.

**Why player_state is split out** (6 concurrent committers)

| shared state | design | tps | latency |
|---|---|---|---|
| ~10KB | player_state row | 5,176 | 1.16 ms |
| ~10KB | games.state blob | 3,306 | 1.81 ms |
| ~1MB | player_state row | 3,491 | 1.72 ms |
| ~1MB | games.state blob | **181** | 33.2 ms |

At RoboRally's realistic state size the throughput win is modest (**1.6x**). The
real result is that player writes become **decoupled from shared-state size**:
1.5x degradation from 10KB→1MB versus 18x for the blob. Treat the split as
insurance plus the fix for secrecy — not as a throughput optimisation.

**Reducer** — ordered replay; duplicate commit and duplicate resolution both
idempotent; resolution deterministic by seat rather than arrival order (so
latency cannot influence outcomes); and **snapshot+tail == full replay**.

## Layout

```
lib/game/types.ts    GameState, GameEvent union, DraftEvent
lib/game/reduce.ts   PURE reducer + server-side action validation (shared both sides)
lib/game/mutate.ts   SHARED-state writes: tx + optimistic concurrency + allocSeq
lib/game/commit.ts   PRIVATE writes: own row only, resolves round atomically
lib/useGameSync.ts   client sync loop: buffer → snapshot → drain → gap-detect
lib/db/index.ts      HTTP driver for reads, pooled driver for write transactions
lib/session.ts       signed-cookie player identity
app/game/[code]/     page.tsx = membership gate, GameView.tsx = the live game
app/api/…            create, join, state, events, action, commit, chat, auth, cron
```

## Going from here to RoboRally

Replace `GameState` in `types.ts` and the `reduce`/`validateAction` pair in
`reduce.ts`. **Nothing in the sync layer changes** — not `mutate`, not
`useGameSync`, not the routes. That separation is the point of the POC.

**Hidden information is already solved** — that was the point of splitting
`player_state` out. Programmed registers go where the hand goes.

Two things still to revisit:
- **Turn timers.** Nothing here advances the game on its own. A player who walks
  away stalls the round; you'll want a deadline plus a scheduled nudge.
- **Pusher message budget.** Pusher counts 1 publish to N subscribers as N+1
  messages. A ~30-round 6-player game costs roughly **2,000 messages** when the
  resolution is broadcast as one script the client animates locally, but ~22,000
  if you emit an event per robot action. That is the difference between ~100 and
  ~9 games/day on the free tier, so keep resolution coarse.
