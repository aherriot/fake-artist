# A Fake Artist Goes to New York

An online multiplayer implementation of the drawing-and-deduction party game.
Next.js on Vercel, Neon Postgres, realtime over Pusher.

**Status: the full round loop works; the canvas is next.** Roles and topics are
dealt in secret, drawing follows seat order for two passes, votes are cast
secretly and revealed together, ties trigger a runoff, a caught Fake Artist
guesses and the room judges it, and scores accumulate across a match. What is
missing is the drawing surface itself — strokes are submitted as normalised
point arrays and the API is complete, but there is no canvas UI yet.

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
lib/game/types.ts     GameState, PrivateState, the GameEvent union, phases
lib/game/reduce.ts    the pure reducer, tally, scoring, and all validation
lib/game/rounds.ts    server-side orchestration: roles, topics, reveal
lib/game/words.ts     the curated {category, topic} pairs
```

### One rule worth knowing before changing any of it

**The reducer is public and must never decide anything that depends on a
secret.** It got this wrong once: `vote_resolved` moved straight to the guess
phase whenever someone was accused, but a guess should only happen if the
accused *is* the Fake Artist — and the reducer cannot know that. The server
now appends either `guess_opened` or `round_revealed`, because only the server
knows. If you find yourself wanting the reducer to branch on something hidden,
that branch belongs in `rounds.ts`.

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

## Design system

**Gallery at Night** — a darkened exhibition space with the artwork lit. The
chrome is gallery signage; the drawing is the only thing that should hold your
eye. Tailwind v4 tokens in `app/globals.css`, primitives in `lib/ui/`,
Headless UI for behaviour.

Browse it at **`/design-system`**.

The governing constraint is that up to ten saturated pen colours share the
screen, so the interface has to recede: everything is warm neutral except one
accent — the Oink hot pink, reserved for the single most important action on a
screen.

Two things in the palette are deliberate departures worth knowing:

- **Pens are Okabe–Ito, darkened.** That standard was authored for chart fills;
  several of its hues are too light to read as a 3px stroke on cream paper.
  Every pen clears 3.2:1 against the paper.
- **Colour never carries attribution alone.** Past about eight categories no
  palette stays reliably distinguishable for anyone, and this game supports
  ten players — so every stroke also carries its seat number.

`@theme static` in `globals.css` is load-bearing: Tailwind v4 tree-shakes theme
variables no utility class references, and the pen colours are consumed through
inline `var(--color-pen-N)`. Without it every stroke renders invisible.

## Setup

1. **Neon** — create a project, copy the **pooled** connection string (host
   contains `-pooler`).
2. **Pusher** — create a Channels app (free Sandbox: 100 connections,
   200k msgs/day).
3. `cp .env.example .env.local` and fill it in. Secrets:
   `openssl rand -base64 32`.
4. `npm install && npm run db:push`  ← **required; the app cannot create its
   own tables**
5. `npm run dev`

`npm run dev` and `npm run build` run a preflight that checks the schema and
tells you to run `db:push` if it is missing. Without that check an empty
database produces a raw Postgres error on the very first click, and nothing
anywhere says why.

> The integration suite cannot catch a missing schema: its harness applies the
> schema to a throwaway database on every run, so the state of your real
> database is invisible to it. That is what the preflight is for.

> Use a **separate** Neon database and Pusher app from any other project —
> the table names are generic and two apps pointed at one database will
> collide.

`preferredRegion` is a literal in each `app/api/**/route.ts` (Next silently
ignores it if re-exported). Point them at your Neon region:

```bash
grep -rl 'preferredRegion' app | xargs sed -i '' 's/"iad1"/"fra1"/'
```

## Playing with 2 people (development only)

Set in `.env.local`, then restart:

```
NEXT_PUBLIC_ALLOW_TWO_PLAYER_GAMES="1"
```

`NEXT_PUBLIC_` because `MIN_PLAYERS` is read on both sides; a server-only flag
would leave the browser disabling Start on a game the server would accept.

**A 2-player game can never catch the fake artist.** Nobody may vote for
themselves, so the only legal votes are A→B and B→A: one vote each, a tie every
time, then the same tie in the runoff, and the fake artist escapes. Every round
ends the same way.

So 2-player mode is for exercising the plumbing — lobby, turn order, drawing,
secret roles, reload — not the game. **Use three browsers to test the real
loop**, including the guess and the guess vote. One normal window and two
incognito ones give you three separate cookie jars.

## Tests

```bash
npm test                 # pure reducer, fast, no database
npm run test:integration # real HTTP against real handlers
npm run test:all
```

`test:integration` boots a throwaway Postgres and the real Next server, runs 19
scenarios, and tears both down — no Neon account, no network. It runs with **no
Pusher credentials**, so the polling fallback is exercised every time.

## Optimistic updates

Your own actions render immediately (measured at ~4ms, one frame) rather than
waiting for the round trip: chat, your stroke, pressing Ready, and casting a
vote.

Predictions live in `lib/game/optimistic.ts`, **separate from the reduced
authoritative state**. That separation is the point: the sync layer's
correctness rests on `seq`-ordered events being the only thing that mutates
game state, so writing a guess into that same object would leave a gap-heal or
a reload unable to tell a prediction from a fact. The view merges the two for
display only.

Rules the module enforces:

- A prediction is retired by the **arrival of its event**, never by the request
  returning. The POST can succeed while the broadcast is still in flight, and
  clearing early makes the message flicker out and back in. Chat carries a
  client nonce that the server echoes so the match is exact.
- **A failed send is kept and flagged**, with retry and discard. Silently
  dropping what someone typed is worse than showing it greyed out.
- A new round clears per-round predictions; chat survives, since it spans them.

Only your own actions are ever predicted. Anything the server decides from
information the client does not have — the vote tally, the reveal, whether a
guess was accepted — is never guessed at.

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
