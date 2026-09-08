import type { GameEvent } from "./types";

/**
 * Pusher rejects a payload over 10KB. 9000 leaves room for the envelope it
 * wraps around ours, and for the multi-byte characters a nickname can contain.
 */
export const MAX_PAYLOAD_BYTES = 9_000;

/** Everything the client needs to know that it is behind, and nothing else. */
export interface SeqHint {
  hint: number;
}

/**
 * Decide what one mutation's events go on the wire as.
 *
 * Normally the events themselves, as a single message: Pusher bills a publish
 * to N subscribers as N+1 messages, so the unit that matters is messages sent,
 * not events produced -- and one mutation routinely produces several.
 *
 * When they do not fit, a hint. A stroke with two thousand points is tens of
 * kilobytes on its own, so splitting the batch does not help; and an over-size
 * trigger is simply rejected, which would leave every client waiting on the
 * slow poll with nothing to say why. A hint is what Pusher is actually for
 * here -- there is something new, seq N, go and read it -- and the client
 * already knows how to fetch from the source of truth.
 *
 * Pure and separate from the Pusher client so the size rule can be tested
 * without credentials or a network.
 */
export function broadcastPayload(events: GameEvent[]): GameEvent[] | SeqHint {
  const body = JSON.stringify(events);
  const bytes = new TextEncoder().encode(body).length;
  if (bytes <= MAX_PAYLOAD_BYTES) return events;
  return { hint: events[events.length - 1].seq };
}
