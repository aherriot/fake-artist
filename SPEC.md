# A Fake Artist Goes to New York — game spec

Agreed rules for this implementation. Where the tabletop game is silent
(ties, scoring) the choice is ours and is marked **[ours]**.

## Roles

- **Real artists** know the topic. They must draw specifically enough to prove
  they know it, but not so specifically that the Fake Artist works it out.
  That dilemma is the game.
- **Fake Artist** knows only the category. They know they are the Fake Artist.
- **Game Master** (optional, 4+ players) picks the pair, does not draw, and
  **wins with the Fake Artist**. Unavailable below 4, where the server always
  picks. Off unless the room turns it on.

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

Source: **one curated built-in list**. No packs, no custom words, no host
configuration. Quality lives in how the pairs are written.

## Round flow

```
role assignment   secret pair dealt; Fake Artist sees category + "you are fake"
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
(guess vote)      real artists only, simple majority, accept or reject  [ours]
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
| Fake Artist not most-voted | Fake Artist (+ GM) |
| Vote ties, then ties again in runoff | Fake Artist (+ GM) **[ours]** |
| Caught, guess accepted | Fake Artist (+ GM) |
| Caught, guess rejected | All real artists |

## Scoring **[ours]**

**1 point to each winner of the round.** Fake Artist and GM each score when
they win; every real artist scores when they win. No weighting, no points for
individually correct votes.

## Match structure

- A series: **one round per player**, so everyone gets exactly one special role.
- **GMing counts as your turn.** With the GM enabled a round consumes two
  players' turns (its GM and its Fake Artist), so a GM match runs about half
  the rounds of a non-GM one. See *Open question 1*.
- Highest score at the end wins.

## Players

- **3 minimum.** No Game Master below 4.
- **10 maximum.**
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

1. **Does a GM match really halve the round count?** "GMing counts as your
   turn" means a 6-player GM match is 3 rounds (each round uses up one GM and
   one Fake Artist), versus 6 rounds without a GM. Coherent, but possibly
   surprising — worth confirming.
2. **Phase timer lengths** for drawing turns, discussion, and voting.
3. **Is the finished drawing kept** after the reveal — a per-match gallery, or
   discarded at the round boundary?
4. **Does the GM rotate by seat**, or volunteer per round?

## Deliberately not decided yet

Stroke wire format, canvas coordinate space, and how strokes are batched for
broadcast. Implementation detail; the preview-then-commit rule already caps
this at one broadcast per turn.
