/**
 * The word list.
 *
 * With no Game Master, this list IS the difficulty of the game. Each entry is
 * a pair, and the game lives in the relationship between the halves:
 *
 *   category  public to everyone, including the Fake Artist. It is their only
 *             foothold -- without it they draw blind and are caught on stroke
 *             one. Too broad and they can never bluff; too narrow and it gives
 *             the topic away and the real artists' skill stops mattering.
 *
 *   topic     secret from the Fake Artist alone. Must be drawable in a handful
 *             of single lines by people who are not artists.
 *
 * Written in the Oink style -- "Something red" / Tomato, not "Fruit" / Tomato.
 * A good category admits many plausible answers while still guiding a drawing.
 */

export interface WordPair {
  category: string;
  topic: string;
}

export const WORD_PAIRS: WordPair[] = [
  // --- Something <adjective> : broad, many candidates, easy to draw ---
  { category: "Something red", topic: "Tomato" },
  { category: "Something red", topic: "Fire engine" },
  { category: "Something red", topic: "Postbox" },
  { category: "Something cold", topic: "Igloo" },
  { category: "Something cold", topic: "Ice cream" },
  { category: "Something cold", topic: "Penguin" },
  { category: "Something round", topic: "Clock" },
  { category: "Something round", topic: "Doughnut" },
  { category: "Something sharp", topic: "Cactus" },
  { category: "Something sharp", topic: "Scissors" },
  { category: "Something heavy", topic: "Anvil" },
  { category: "Something heavy", topic: "Elephant" },
  { category: "Something loud", topic: "Drum kit" },
  { category: "Something loud", topic: "Alarm clock" },
  { category: "Something soft", topic: "Pillow" },
  { category: "Something tall", topic: "Giraffe" },
  { category: "Something tall", topic: "Lighthouse" },
  { category: "Something slippery", topic: "Banana peel" },
  { category: "Something that smells", topic: "Rubbish bin" },
  { category: "Something sticky", topic: "Honey jar" },

  // --- Something that <verb> : action gives a drawing angle ---
  { category: "Something that flies", topic: "Helicopter" },
  { category: "Something that flies", topic: "Kite" },
  { category: "Something that flies", topic: "Bat" },
  { category: "Something that floats", topic: "Buoy" },
  { category: "Something that floats", topic: "Hot air balloon" },
  { category: "Something that ticks", topic: "Metronome" },
  { category: "Something that spins", topic: "Windmill" },
  { category: "Something that spins", topic: "Record player" },
  { category: "Something that grows", topic: "Sunflower" },
  { category: "Something that melts", topic: "Snowman" },
  { category: "Something that stings", topic: "Jellyfish" },
  { category: "Something that opens", topic: "Umbrella" },
  { category: "Something that glows", topic: "Firefly" },
  { category: "Something that bounces", topic: "Basketball" },

  // --- Something you <verb> : familiar objects, hard to pin down ---
  { category: "Something you wear", topic: "Top hat" },
  { category: "Something you wear", topic: "Wellington boots" },
  { category: "Something you wear", topic: "Sunglasses" },
  { category: "Something you sit on", topic: "Deckchair" },
  { category: "Something you sit on", topic: "Tractor" },
  { category: "Something you climb", topic: "Ladder" },
  { category: "Something you post", topic: "Parcel" },
  { category: "Something you carry", topic: "Suitcase" },
  { category: "Something you plug in", topic: "Toaster" },
  { category: "Something you water", topic: "Houseplant" },
  { category: "Something you fold", topic: "Paper aeroplane" },
  { category: "Something you queue for", topic: "Rollercoaster" },

  // --- Somewhere / place ---
  { category: "Somewhere you get wet", topic: "Waterfall" },
  { category: "Somewhere very quiet", topic: "Library" },
  { category: "Somewhere underground", topic: "Subway station" },
  { category: "Somewhere you sleep", topic: "Tent" },
  { category: "A place in New York", topic: "Statue of Liberty" },
  { category: "A place in New York", topic: "Yellow taxi" },
  { category: "A place in New York", topic: "Brooklyn Bridge" },
  { category: "Somewhere animals live", topic: "Beehive" },

  // --- In the kitchen / house : everyday, many candidates ---
  { category: "Something in a kitchen", topic: "Kettle" },
  { category: "Something in a kitchen", topic: "Whisk" },
  { category: "Something in a bathroom", topic: "Toothbrush" },
  { category: "Something in a garden", topic: "Wheelbarrow" },
  { category: "Something on a desk", topic: "Stapler" },
  { category: "Something in a toolbox", topic: "Spirit level" },

  // --- Trickier: abstract or compound, for groups who want a harder game ---
  { category: "Something with a tail", topic: "Comet" },
  { category: "Something with strings", topic: "Marionette" },
  { category: "Something with a handle", topic: "Watering can" },
  { category: "Something with holes in it", topic: "Colander" },
  { category: "Something in a fairy tale", topic: "Glass slipper" },
  { category: "Something in space", topic: "Satellite" },
  { category: "Something in a hospital", topic: "Crutches" },
  { category: "Something at a circus", topic: "Unicycle" },
  { category: "Something at the seaside", topic: "Sandcastle" },
  { category: "Something in an orchestra", topic: "Harp" },
];

/**
 * Pick a pair not already used this match.
 *
 * Takes an rng so rounds are reproducible in tests; falls back to reusing the
 * list once exhausted rather than failing a long match.
 */
export function pickPair(usedTopics: string[], rng: () => number = Math.random): WordPair {
  const unused = WORD_PAIRS.filter((p) => !usedTopics.includes(p.topic));
  const pool = unused.length > 0 ? unused : WORD_PAIRS;
  return pool[Math.floor(rng() * pool.length)];
}
