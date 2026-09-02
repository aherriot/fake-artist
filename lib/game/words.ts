/**
 * The word list.
 *
 * With no Game Master, this list IS the difficulty of the game, and its shape
 * matters as much as its contents.
 *
 * Categories are BROAD and each holds many topics. That is the whole point:
 * the category is public, so a category that maps to one topic hands the Fake
 * Artist the answer, and over repeated play the list becomes a lookup table
 * ("Something with strings" → always Marionette).
 *
 * Breadth is the difficulty dial, and it cuts both ways. Too narrow and the
 * category IS the answer; too broad ("Something") and the Fake Artist has no
 * foothold, draws a meaningless squiggle, and is caught on stroke one. These
 * sit where a category admits many candidates while still guiding a drawing.
 *
 * Topics deliberately appear under more than one category (a wheelbarrow is
 * both "something with wheels" and "something in a garden"), so the mapping is
 * many-to-many in both directions and cannot be memorised as a lookup.
 *
 * Written in the Oink style: "Something red", not "Fruit". Every topic must be
 * drawable in a handful of single lines by people who cannot draw.
 */

export interface WordPair {
  category: string;
  topic: string;
}

export interface Category {
  category: string;
  topics: string[];
}

/** Below this, the category starts to give the answer away. Enforced by test. */
export const MIN_TOPICS_PER_CATEGORY = 18;

export const CATEGORIES: Category[] = [
  {
    category: "Something red",
    topics: ["Tomato", "Fire engine", "Postbox", "Strawberry", "Stop sign", "Lipstick",
      "Ladybird", "Rose", "Chilli pepper", "Santa hat", "Telephone box", "Ketchup bottle",
      "Fire extinguisher", "Cherry", "Boxing glove", "Traffic cone", "Radish", "Matador's cape"],
  },
  {
    category: "Something cold",
    topics: ["Igloo", "Ice cream", "Penguin", "Snowman", "Fridge", "Iceberg",
      "Ice cube", "Skis", "Snowflake", "Polar bear", "Ice skate", "Thermos flask",
      "Snow globe", "Sledge", "Woolly hat", "Icicle", "Freezer", "Snow plough"],
  },
  {
    category: "Something that flies",
    topics: ["Helicopter", "Kite", "Bat", "Rocket", "Butterfly", "Hot air balloon",
      "Frisbee", "Owl", "Paper aeroplane", "Drone", "Bumblebee", "Dragonfly",
      "Boomerang", "Parachute", "Witch on a broom", "Hang glider", "Pterodactyl", "Firework"],
  },
  {
    category: "An animal",
    topics: ["Giraffe", "Octopus", "Hedgehog", "Flamingo", "Tortoise", "Snail",
      "Camel", "Squirrel", "Jellyfish", "Rhinoceros", "Peacock", "Sloth",
      "Crocodile", "Bat", "Seahorse", "Kangaroo", "Porcupine", "Walrus", "Toucan", "Armadillo"],
  },
  {
    category: "Something in a kitchen",
    topics: ["Kettle", "Whisk", "Toaster", "Colander", "Rolling pin", "Blender",
      "Frying pan", "Cheese grater", "Corkscrew", "Teapot", "Chopping board", "Oven glove",
      "Egg cup", "Tin opener", "Pepper grinder", "Ladle", "Measuring jug", "Cafetiere"],
  },
  {
    category: "Something in a house",
    topics: ["Bathtub", "Toothbrush", "Staircase", "Chandelier", "Fireplace", "Doormat",
      "Rubber duck", "Grandfather clock", "Hairdryer", "Bookshelf", "Plug socket", "Radiator",
      "Stepladder", "Mousetrap", "Letterbox", "Vacuum cleaner", "Coat hook", "Rocking chair"],
  },
  {
    category: "Something you wear",
    topics: ["Top hat", "Wellington boots", "Sunglasses", "Scarf", "Bow tie", "Mittens",
      "Crown", "Apron", "Flip flops", "Helmet", "Wristwatch", "Backpack",
      "Snorkel mask", "Dungarees", "Eyepatch", "Cowboy boots", "Tutu", "Monocle"],
  },
  {
    category: "Something with wheels",
    topics: ["Skateboard", "Wheelbarrow", "Shopping trolley", "Tractor", "Unicycle",
      "Roller skates", "Pram", "Double-decker bus", "Wheelchair", "Caravan", "Go-kart", "Suitcase",
      "Steamroller", "Rickshaw", "Fire engine", "Hot dog cart", "Penny farthing", "Skip"],
  },
  {
    category: "Something at the seaside",
    topics: ["Sandcastle", "Deckchair", "Lighthouse", "Seagull", "Bucket and spade", "Pier",
      "Starfish", "Surfboard", "Ice cream van", "Beach ball", "Crab", "Message in a bottle",
      "Anchor", "Windbreak", "Rowing boat", "Sun umbrella", "Rock pool", "Pedalo"],
  },
  {
    category: "Something with a handle",
    topics: ["Watering can", "Umbrella", "Frying pan", "Suitcase", "Mug", "Broom",
      "Briefcase", "Axe", "Bucket", "Magnifying glass", "Kettle", "Tennis racket",
      "Pushchair", "Saucepan", "Toolbox", "Skipping rope", "Hand mirror", "Wheelbarrow"],
  },
  {
    category: "Something that makes a sound",
    topics: ["Drum kit", "Alarm clock", "Whistle", "Church bell", "Harp", "Doorbell",
      "Trumpet", "Cuckoo clock", "Maracas", "Foghorn", "Accordion", "Wind chime",
      "Gramophone", "Triangle", "Bagpipes", "Megaphone", "Tambourine", "Grandfather clock"],
  },
  {
    category: "Something in space",
    topics: ["Satellite", "Comet", "Rocket", "Astronaut", "Telescope", "Crescent moon",
      "Space station", "Flying saucer", "Ringed planet", "Space helmet", "Shooting star", "Moon buggy",
      "Solar panel", "Constellation", "Launch pad", "Space probe", "Asteroid", "Sundial"],
  },
  {
    category: "Something in a garden",
    topics: ["Wheelbarrow", "Watering can", "Birdhouse", "Garden gnome", "Greenhouse",
      "Lawnmower", "Sunflower", "Scarecrow", "Beehive", "Rake", "Hosepipe", "Garden pond",
      "Compost bin", "Trellis", "Bird bath", "Picket fence", "Plant pot", "Hammock"],
  },
  {
    category: "Something a person can ride",
    topics: ["Horse", "Motorbike", "Rollercoaster", "Camel", "Ski lift", "Zip wire",
      "Elephant", "Sledge", "Jet ski", "Carousel horse", "Penny farthing", "Donkey",
      "Tandem bicycle", "Ostrich", "Escalator", "Chairlift", "Toboggan", "Space hopper"],
  },
  {
    category: "Something that opens and closes",
    topics: ["Umbrella", "Book", "Zip", "Drawbridge", "Folding fan", "Clam",
      "Wallet", "Briefcase", "Curtains", "Penknife", "Garden gate", "Laptop",
      "Deckchair", "Cuckoo clock", "Trapdoor", "Peacock's tail", "Accordion", "Purse"],
  },
  {
    category: "Something you find in a city",
    topics: ["Traffic light", "Fire hydrant", "Skyscraper", "Yellow taxi", "Subway entrance",
      "Street lamp", "Bridge", "Fountain", "Bus stop", "Statue", "Manhole cover", "Newsstand",
      "Zebra crossing", "Parking meter", "Scaffolding", "Revolving door", "Ferris wheel", "Billboard"],
  },
  {
    category: "Something with legs",
    topics: ["Spider", "Piano", "Giraffe", "Tripod", "Octopus", "Stepladder",
      "Crab", "Deckchair", "Flamingo", "Ostrich", "Easel", "Bar stool",
      "Card table", "Millipede", "Grasshopper", "Trestle", "Wading bird", "Camera tripod"],
  },
];

/** Flattened pairs, for anything that wants the old shape. */
export const WORD_PAIRS: WordPair[] = CATEGORIES.flatMap((c) =>
  c.topics.map((topic) => ({ category: c.category, topic })),
);

/**
 * Pick a pair for a round.
 *
 * Prefers a category the match has not used yet, purely for variety, then a
 * topic from it that has not come up. Never reuses a topic while an unused one
 * exists; falls back gracefully rather than failing a long match.
 *
 * Takes an rng so rounds are reproducible in tests.
 */
export function pickPair(
  usedTopics: string[] = [],
  usedCategories: string[] = [],
  rng: () => number = Math.random,
): WordPair {
  const withUnused = CATEGORIES.filter((c) => c.topics.some((t) => !usedTopics.includes(t)));
  const pool = withUnused.length > 0 ? withUnused : CATEGORIES;

  const fresh = pool.filter((c) => !usedCategories.includes(c.category));
  const chosen = (fresh.length > 0 ? fresh : pool)[
    Math.floor(rng() * (fresh.length > 0 ? fresh.length : pool.length))
  ];

  const topics = chosen.topics.filter((t) => !usedTopics.includes(t));
  const from = topics.length > 0 ? topics : chosen.topics;
  return { category: chosen.category, topic: from[Math.floor(rng() * from.length)] };
}
