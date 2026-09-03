# A Fake Artist Goes to New York — game spec

Agreed rules for this implementation. Where the tabletop game is silent
(ties, scoring) the choice is ours and is marked **[ours]**.

## Roles

- **Real artists** know the topic. They must draw specifically enough to prove
  they know it, but not so specifically that the Fake Artist works it out.
  That dilemma is the game.
- **Fake Artist** knows only the category. They know they are the Fake Artist.
There is **no Game Master**. The server picks the pair, so everybody draws.

> Cut deliberately. Online, most of the tabletop GM's job is either automated
> (dealing the secret), replaced (adjudicating the guess, now a vote), or
> reducible to content (supplying the pair). What genuinely survived was
> "tailor the words to this group" and "give a non-drawer a role" -- and the
> first is better served by custom pairs than by a special player. The GM also
> removes a drawer, which hurts most in exactly the small games we want to
> support. Room-supplied custom pairs are the intended follow-up; the
> private-state plumbing a GM would need already exists if we change our mind.

## The pair

Every round has a `{category, topic}` pair: the **category is public** to
everyone including the Fake Artist; the **topic is secret** from the Fake
Artist alone.

Both are load-bearing. The topic is the secret to be protected; the category is
what makes faking possible at all — without it the Fake Artist draws blind and
is caught on stroke one. The category is also the only difficulty dial: too
broad and the Fake Artist can never bluff, too narrow and it gives the topic
away. Authored in the Oink style — *"Something red" / Tomato*, not
*"Fruit" / Tomato*.

Source: **one curated built-in list**. No packs, no host configuration.
Quality lives in how the pairs are written.

Room-supplied custom pairs are the planned follow-up, and are the cheap way to
get what a Game Master would have offered.

## Round flow

```
role assignment   server deals the pair; Fake Artist sees category + "you are fake"
      ▼
drawing           fixed seat order, 2 passes, one continuous line per turn
      ▼           preview with Undo / Submit; committing ends your turn
      ▼
voting            simultaneous, revealed together
      ▼
(runoff)          on a tie, revote among the tied players only          [ours]
      ▼
(guess)           if caught: Fake Artist types a free-text guess
      ▼
(guess vote)      other players vote, simple majority, accept or reject  [ours]
      ▼
reveal            roles, pair, and outcome shown; scores updated
```

### Drawing

- **One continuous line per turn.** Pen-down to pen-up.
- Drawn line is **previewed**; Undo redraws it, Submit commits and ends the
  turn. The preview exists because a misclick online has no table to appeal to.
- Because nothing is broadcast until Submit, other players never see an undone
  line — and the message cost is one broadcast per turn, not per pixel.
- **Fixed seat order**, same every round.
- **Two lines each**, i.e. two passes around the table.
- Each player draws in their own colour, assigned by seat.
- No erasing.

### Phase advancement

**No timers in v1.** Every phase ends when the people in it have acted, with a
host override for anyone stuck:

| Phase | Ends when | Override |
|---|---|---|
| drawing turn | that player submits their line | host skips them |
| voting | all players have voted | host excludes a non-voter |
| guess | the Fake Artist submits | — |
| guess vote | all other players have voted | host excludes a non-voter |
| reveal | host presses *Next round* | — |

**There is no discussion phase [ours].** The last line drawn opens the ballot
directly. Talking still happens — it happens with the vote already open, which
removes a whole round of "press Ready" bookkeeping from what is meant to be a
party game. Whether any of this needs a clock is a question for play-testing.

### AFK

On timeout the game **pauses** with a visible "waiting for X" and the host may
skip or kick. Nothing is auto-drawn — a forged line would frame an innocent
player, and a silent skip leaks information either way.

## Win conditions

| Outcome | Winner |
|---|---|
| Fake Artist not most-voted | Fake Artist |
| Vote ties, then ties again in runoff | Fake Artist **[ours]** |
| Caught, guess accepted | Fake Artist |
| Caught, guess rejected | All real artists |

## Scoring **[ours]**

**1 point to each winner of the round.** The Fake Artist scores when they win;
every real artist scores when they win. No weighting, no points for
individually correct votes.

## Match structure

- A series of **N rounds for N players**. Highest score at the end wins; ties
  are reported as ties rather than broken.
- The host may **end the match early**, but only at a reveal — stopping
  mid-round would strand a drawing, a ballot, or a guess someone is part-way
  through. It asks for confirmation, since it ends the game for everyone.
- The Fake Artist is **not** a rotation and **not** "everyone exactly once".
  That rule sounds fair, and is, but it leaks: with N players over N rounds the
  final round is fully determined — everyone knows who the Fake Artist is
  before a line is drawn — and the round before it is a coin flip.
- Instead: never the same player twice running, weighted towards whoever has
  faked least, and **no player may ever be more than 1.25x likelier than an
  even split**. A hard ceiling, not an average.

  Measured, worst realistic case (everyone has faked once except one player):

  | players | even split | best possible guess | old rule |
  |---|---|---|---|
  | 5 | 25% | 31% | 100% |
  | 6 | 20% | 25% | 100% |
  | 8 | 14% | 17% | 100% |

  The cost is that the role is no longer shared perfectly: over a 6-round match
  the gap between most and least faked averages 1.9, and someone misses out
  entirely in most matches. Unpredictability was judged worth more.

## Players

- **3 minimum**, **10 maximum**.
- **2 allowed behind a dev flag only**, so the full flow can be exercised
  across two browsers.
- **Open join at any round boundary.** Between rounds is a safe moment to
  arrive: no drawing to interrupt, no ballot half-cast, and the next round
  deals everyone in from scratch. Latecomers are appended to the seat order.
  Mid-round joins are refused, with a message saying when to try again.
- A disconnected player keeps their seat and role and may rejoin — the signed
  cookie already makes this work.

## Devices

Desktop and mobile treated equally, responsive throughout. Touch drawing must
work as well as mouse; the canvas suppresses scroll/pan gestures while drawing.

## Deferred to later phases

- **Timers.** None in v1. Play-testing decides whether any phase needs a clock;
  the host override covers a stalled game until then.
- **Drawing gallery.** Finished drawings shown together at the end of a match.
  Worth keeping in mind now only so far as strokes are stored durably in the
  event log, which they already are — no schema change will be needed.
- **Room-supplied custom pairs**, the cheap replacement for a Game Master.

## Deliberately not decided yet

Stroke wire format, canvas coordinate space, and how strokes are batched for
broadcast. Implementation detail; the preview-then-commit rule already caps
this at one broadcast per turn.
