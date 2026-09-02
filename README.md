# A Fake Artist Goes to New York

An online multiplayer implementation of the drawing-and-deduction party game.
Next.js on Vercel, Neon Postgres, realtime over Pusher.

**Status: rules not implemented.** What works today is the platform underneath
them — lobby, join by code, presence, realtime sync, reload-resume, private
per-player state, error handling, cleanup, and a test suite. The canvas, roles,
word, turn order, and voting are next.

The sync layer is inherited from an earlier prototype (the git history predates
this game) where it was built and load-tested. Only the rules layer changed.

## The core idea

**Neon is the source of truth. Pusher is only a notification hint.**

Every mutation is one transaction that updates state *and* appends to a
per-game event log with a gapless `seq`. Clients hold a cursor. Pusher pushes
events; if a client sees a gap it refetches and heals itself.

```
POST /api/games/CODE/...
        │
        ▼
  ┌─────────────────────────────┐
  │ 1. validate (inside the tx) │
  │ 2. write (version-guarded)  │──► Neon  ◄── source of truth
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

One rule covers dropped messages, duplicates, reordering, reconnects and
reloads, with no special cases:

```
seq == lastSeq + 1  → apply
seq >  lastSeq + 1  → gap, refetch from DB
seq <= lastSeq      → duplicate, ignore
```

## Public vs private state

This game is built on hidden information — the word, and who the fake artist
is — so the split matters more here than it did in the prototype:

| | `games.state` (jsonb) | `player_state` (row per player) |
|---|---|---|
| holds | whatever everyone may see | whatever only its owner may see |
| visibility | broadcast to all | returned only to its owner |
| written by | `lib/game/mutate.ts` | `lib/game/private.ts` |

**Every payload in the event log is public by construction.** Secrets go to a
player's own row and never to the log, so no broadcast can leak them. When you
add a secret, it goes in `PrivateState`; when you add something everyone sees,
it goes in `GameState` and gets an event.

Per-player rows also mean many players acting at once write different tuples
and never conflict.

## Where the rules go

The seam is deliberate — these files change, nothing else does:

```
lib/game/types.ts     GameState, PrivateState, the GameEvent union
lib/game/reduce.ts    the pure reducer + server-side action validation
```

Supporting cast, already built and tested:

```
lib/game/mutate.ts    SHARED-state writes: tx + optimistic concurrency + allocSeq
lib/game/private.ts   PRIVATE writes: own row only, advisory-locked
lib/useGameSync.ts    client sync loop: buffer → snapshot → drain → gap-detect
lib/db/index.ts       Neon drivers for Neon hosts, plain pg otherwise
lib/session.ts        signed-cookie player identity
lib/api.ts            every route returns JSON, never an empty body
lib/fetch-json.ts     client fetch with no throwing path
app/game/[code]/      page.tsx = membership gate, GameView.tsx = the live game
```

`initPrivateState()` seeds secrets inside the same transaction that starts the
game, so nobody can observe an active game without their private state. That is
where the word and the fake artist get assigned.

## Setup

1. **Neon** — create a project, copy the **pooled** connection string (host
   contains `-pooler`).
2. **Pusher** — create a Channels app (free Sandbox: 100 connections,
   200k msgs/day).
3. `cp .env.example .env.local` and fill it in. Secrets:
   `openssl rand -base64 32`.
4. `npm install && npm run db:push`
5. `npm run dev`

> Use a **separate** Neon database and Pusher app from any other project —
> the table names are generic and two apps pointed at one database will
> collide.

`preferredRegion` is a literal in each `app/api/**/route.ts` (Next silently
ignores it if re-exported). Point them at your Neon region:

```bash
grep -rl 'preferredRegion' app | xargs sed -i '' 's/"iad1"/"fra1"/'
```

## Tests

```bash
npm test                 # pure reducer, fast, no database
npm run test:integration # real HTTP against real handlers
npm run test:all
```

`test:integration` boots a throwaway Postgres and the real Next server, runs 19
scenarios, and tears both down — no Neon account, no network. It runs with **no
Pusher credentials**, so the polling fallback is exercised every time.

## When things break

| Failure | What the user sees |
|---|---|
| Component throws | `app/error.tsx` — plain message, Try again / Reload / Home |
| Root layout throws | `app/global-error.tsx` — dependency-free last resort |
| Stale bundle after deploy | "A new version is available" + Reload |
| Bad game code | "No game with that code", with the code alphabet as a hint |
| Network blip | Retried twice with backoff, then Try again |
| API throws | JSON + a `requestId` echoed in the UI and the server log |
| Pusher down or unconfigured | Degrades to 2s polling; the game stays playable |
| Legacy/partial game row | `normalizeGameState` fills defaults instead of crashing |

## Still to build

Rules aside, two platform gaps the prototype never closed:

- **Turn timers.** Nothing advances a game on its own; a player who walks away
  stalls it. This game needs them more than the prototype did.
- **Pusher message budget.** Pusher counts 1 publish to N subscribers as N+1
  messages. Drawing is the risk here: a stroke-per-event design could be
  thousands of messages per game. Batch strokes.
