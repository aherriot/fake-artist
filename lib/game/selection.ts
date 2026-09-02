/**
 * Who draws in what order, and who is the fake artist.
 *
 * Pure and dependency-free on purpose: this is the part of the rules most
 * worth measuring, and keeping it out of the database layer means the normal
 * test suite can sample the real distribution rather than a model of it.
 */

/** Fisher-Yates. Takes an rng so seat order is reproducible in tests. */
export function shuffle<T>(xs: T[], rng: () => number = Math.random): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * How much likelier than an even split any one player may be. A hard ceiling,
 * not an average: it bounds how well anyone can guess the fake artist from
 * role history alone, however long the match runs.
 */
const MAX_RELATIVE_ODDS = 1.25;

/**
 * Choose this round's Fake Artist.
 *
 * Not a rotation, and deliberately not "everyone exactly once". That rule
 * sounds fair and is fair, but it leaks: with N players over N rounds the last
 * round is fully determined -- everyone knows who the fake artist is before a
 * line is drawn -- and the round before it is a coin flip.
 *
 * Instead: never the same player twice running, weighted towards whoever has
 * faked least, and no player ever more than MAX_RELATIVE_ODDS times likelier
 * than an even split. Fairness pressure without ever making the answer
 * deducible. Over a 6-player match that keeps the best possible guess to
 * roughly 25% against a 20% floor, while still spreading the role around.
 */
export function pickFakeArtist(
  seatOrder: string[],
  /** One entry per completed round, in order. May repeat. */
  fakeHistory: string[],
  rng: () => number = Math.random,
): string {
  if (seatOrder.length === 0) throw new Error("no players");
  if (seatOrder.length === 1) return seatOrder[0];

  const counts = new Map(seatOrder.map((id) => [id, 0]));
  for (const id of fakeHistory) {
    if (counts.has(id)) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const previous = fakeHistory[fakeHistory.length - 1];

  // Back-to-back is both predictable and unfun, so the last fake sits out.
  const pool = seatOrder.filter((id) => id !== previous);
  const candidates = pool.length > 0 ? pool : seatOrder;

  // Favour whoever has faked least...
  let probs = candidates.map((id) => 1 / (1 + (counts.get(id) ?? 0)));
  let total = probs.reduce((a, b) => a + b, 0);
  probs = probs.map((w) => w / total);

  // ...then cap, redistributing the excess, so no one becomes a safe bet.
  const cap = Math.min(1, MAX_RELATIVE_ODDS / candidates.length);
  for (let i = 0; i < 50; i++) {
    const excess = probs.reduce((a, p) => a + Math.max(0, p - cap), 0);
    if (excess < 1e-9) break;
    const room = probs.reduce((a, p) => a + Math.max(0, cap - Math.min(p, cap)), 0);
    if (room < 1e-9) break;
    probs = probs.map((p) => Math.min(p, cap) + (Math.max(0, cap - Math.min(p, cap)) / room) * excess);
  }

  let x = rng() * probs.reduce((a, b) => a + b, 0);
  for (let i = 0; i < candidates.length; i++) {
    x -= probs[i];
    if (x <= 0) return candidates[i];
  }
  return candidates[candidates.length - 1];
}

