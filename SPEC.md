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
discussion        timed; voice assumed, in-app chat as fallback
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

- A series: **one round per player**, so everyone is the Fake Artist exactly
  once. A 6-player match is 6 rounds.
- Highest score at the end wins.

## Players

- **3 minimum**, **10 maximum**.
- **2 allowed behind a dev flag only**, so the full flow can be exercised
  across two browsers.
- **Open join at any round boundary.** Joiners append to the seat order and the
  remaining rotation recomputes. No mid-round joins.
- A disconnected player keeps their seat and role and may rejoin — the signed
  cookie already makes this work.

## Devices

Desktop and mobile treated equally, responsive throughout. Touch drawing must
work as well as mouse; the canvas suppresses scroll/pan gestures while drawing.

## Open questions

1. **Phase timer lengths** for drawing turns, discussion, and voting.
2. **Is the finished drawing kept** after the reveal — a per-match gallery, or
   discarded at the round boundary?

## Deliberately not decided yet

Stroke wire format, canvas coordinate space, and how strokes are batched for
broadcast. Implementation detail; the preview-then-commit rule already caps
this at one broadcast per turn.
