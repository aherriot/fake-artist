# A Fake Artist Goes to New York

### ▸ Play it: **[play-fake-artist.vercel.app](https://play-fake-artist.vercel.app)**

An online multiplayer implementation of the drawing-and-deduction party game.
Three to ten players, one shared room code, no accounts and no install.
Next.js on Vercel, Neon Postgres, realtime over Pusher.

**Status: playable.** A full match runs end to end in the browser — lobby,
secret roles, drawing on a shared canvas, a secret ballot, runoffs, the guess
and the room's judgement of it, and a scoreboard across rounds.

The sync layer is inherited from an earlier prototype (the git history predates
this game) where it was built and load-tested. Only the rules layer changed.

## The game

Everyone is dealt the same subject to draw — a **topic**, say *Tomato* — except
one player. The **Fake Artist** is told only the public **category**,
*Something red*, and that they are the fake. Nobody else knows who they are.

Then everybody draws. One continuous line each, in seat order, twice around the
table. No erasing, no writing words, no taking it back once you commit.

The real artists have to draw specifically enough to prove they know the topic,
but not so specifically that the Fake Artist works it out from what is already
on the paper. That dilemma is the entire game. The Fake Artist has to add a
line that looks like it belongs to a drawing they cannot see the point of.

When the last line lands the room votes, in secret, all at once. Accuse the
wrong person — or fail to agree at all — and the Fake Artist walks. Catch them
and they get one guess at the subject; guess right and they still win it.

A point to each winner, one round per player, highest score takes the match.
Full rules, including every choice the tabletop game leaves open to the table,
are in [SPEC.md](SPEC.md).

## Why it is technically interesting

It is a hidden-information game played over a broadcast channel, on a platform
with no server to keep anything in memory. Most of what follows comes from
those two constraints.

- **Secrets that cannot leak, by construction.** The usual approach is to
  filter state per recipient and hope nobody forgets. Here the event log is
  public *by definition* — the topic and the Fake Artist's identity live in
  per-player rows that only their owner is ever sent, so there is no filtering
  step to get wrong and no broadcast that could carry the answer.
  [Public vs private state](#public-vs-private-state).
- **A pure reducer that must not know too much.** Client and server run the
  same reduction over the same ordered log, which is what stops them drifting —
  but it also means the reducer is public, so it may never branch on a secret.
  It got that wrong once, and the fix is the seam the rules now sit on:
  [Where the rules go](#where-the-rules-go).
- **No stateful server, and no lost events.** Serverless functions die between
  requests, so there are no room objects and no socket server. Every mutation
  is one transaction that writes state *and* appends to a gapless per-game
  `seq`; clients hold a cursor and one rule — next, gap, or duplicate — covers
  dropped messages, reordering, reconnects and reloads with no special cases.
  [The core idea](#the-core-idea).
- **Realtime you can switch off.** Pusher is a notification hint, never the
  source of truth, so with no credentials at all the app falls back to polling
  and every rule still holds. The integration suite runs that way on purpose,
  which means the degraded path is tested on every single run.
- **Simultaneous writers, no lock contention.** Ten players commit at the same
  instant every round. Shared state takes an optimistic version guard with
  jittered retry; private state goes to one row per player, so those writes
  never touch the same tuple — measured at ~31x the throughput of serialising
  them through `games.state`.
- **Optimistic UI kept structurally apart from truth.** Predictions live in
  their own object and are retired by the *arrival of their event*, never by
  the request returning, so a gap-heal or a reload can never mistake a guess
  for a fact. [Optimistic updates](#optimistic-updates).
- **Every failure has a named outcome.** Stale bundle, bad code, dead network,
  Pusher down, a legacy row — each one has a defined thing the player sees
  rather than a blank screen. [When things break](#when-things-break).
- **Tested in two halves.** The rules are a pure state machine with no database
  in sight, so 54 invariants run in about a second; the plumbing gets 37
  scenarios over real HTTP against a throwaway Postgres. [Tests](#tests).

## The core idea

**Neon is the source of truth. Pusher is only a notification hint.**

Every mutation is one transaction that updates state *and* appends to a
per-game event log with a gapless `seq`. Clients hold a cursor. Pusher pushes
one message per mutation carrying that mutation's events; if a client sees a
gap it refetches and heals itself.

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
             [seq N+1, N+2]  ← ONE message, all this mutation's events
        ┌────────┼────────┐
        ▼        ▼        ▼
     apply    apply    gap! ──► GET /events?since=N
```

One message per mutation, not per event, because Pusher bills a publish to N
subscribers as N+1 messages — and a single mutation routinely produces several
events (the last vote of a round appends `vote_resolved` and then
`guess_opened` or `round_revealed`). The client applies an ordered array in the
same loop it uses for a gap-heal, so this costs nothing in complexity.

A batch over Pusher's 10KB limit is sent as `{ hint: seq }` instead. One stroke
can exceed that on its own, so splitting would not help; and an over-size
trigger is simply rejected, which would strand every client until the next
sweep. The hint says *there is something new, seq N* and the client fetches it
from the source of truth — which is all Pusher was ever doing here.
`broadcastPayload` in `lib/game/broadcast.ts` owns that rule and is tested.

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
- **There are two pen ramps, and using the wrong one is a real bug.**
  `penVar()` is ink on white paper, for strokes and swatches. `penTextVar()` is
  the lightened counterpart for names on the dark UI: six of the ten pens fail
  contrast as text against the wall, and seat 8 — ink — sits at 1.09, which is
  invisible. Player names are coloured everywhere they appear, so this matters
  in prose as much as in the roster.

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

## The canvas

SVG in a 0..1 viewBox rather than a raster canvas, so the same normalised
points render crisply at any size and can be replayed from the event log later
without storing pixels.

One continuous line per turn: pointer-down to pointer-up makes the stroke,
which is then previewed with Undo and Submit. Nothing is sent until you submit,
so a shaky trackpad costs a redraw rather than your turn. Pointer capture keeps
the line following you past the edge of the sheet, and points closer than
0.004 apart are dropped.

Every stroke carries its **seat number** at its start point, and hovering a
name in the roster dims every line that is not theirs. Colour cannot separate
ten players, and "whose line is that?" is the question the game turns on, so
this is the mechanism rather than a convenience.

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

## Verifying a deployment

```bash
npm run verify:deploy https://play-fake-artist.vercel.app
```

Plays a real round against the deployed site and checks the things that fail
**silently**:

- **Realtime actually configured.** `NEXT_PUBLIC_*` is inlined at *build* time,
  so if the Pusher key was not set in Vercel before the build ran, the app does
  not error — every client quietly falls back to 2-second polling. It works,
  just slowly and at needless database cost, and nothing in the logs says so.
  Setting the variable is not enough: **the build must re-run.**
- **The production database has a schema.** Otherwise the first click 503s.
- **`CRON_SECRET` is set**, or cleanup 500s forever and old games pile up.
- **Secrets stay secret**, checked mid-round — after the reveal the topic is
  public by design, so asserting it is hidden at that point tests nothing.

It leaves one finished game behind, with players named `smoke-*`; the cleanup
cron removes it within 24 hours.

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

Rules aside, the platform gaps the prototype never closed:

- **Turn timers.** Nothing advances a game on its own; a player who walks away
  stalls it. This game needs them more than the prototype did.
- **Host migration.** `host_id` is set once and never moves, and every override
  — skip, next round, drop, end match, play again — is host-only. A host who
  closes their tab freezes the room with no way out. Worse than the missing
  timers, because there is no override at all.
- **Rate limiting.** Nothing caps how fast a player can act. Every accepted
  mutation appends to the log *and* fans out, so a script in a room can inflate
  both the Pusher bill and the Neon one.

Done since: **the Pusher message budget**. Broadcasts are one message per
mutation, over-size batches degrade to a seq hint, and the redundancy poll runs
at 60s rather than 15s now that every other route back into sync is covered.
