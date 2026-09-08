import Pusher from "pusher";
import { broadcastPayload } from "./game/broadcast";
import type { GameEvent } from "./game/types";

export const pusher = new Pusher({
  appId: process.env.PUSHER_APP_ID!,
  key: process.env.NEXT_PUBLIC_PUSHER_KEY!,
  secret: process.env.PUSHER_SECRET!,
  cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER!,
  useTLS: true,
});

/**
 * Channels are keyed by join CODE, not game id.
 *
 * This is deliberate: the client knows the code from the URL, so it can
 * subscribe BEFORE fetching the snapshot. Keying by game id would force it
 * to fetch first and subscribe second, opening a window where events fired
 * between the two are lost.
 */
export const channelFor = (code: string) => `presence-game-${code.toUpperCase()}`;
export const EVENT_NAME = "game-event";

/**
 * Fan out one mutation's events as ONE message.
 *
 * Pusher bills a publish to N subscribers as N+1 messages, so the unit that
 * matters is messages sent, not events produced -- and a single mutation
 * routinely produces several. The last vote of a round appends `vote_resolved`
 * and then `guess_opened` or `round_revealed`; starting a match appends
 * `match_started` and `round_started`. Sending those separately multiplied the
 * busiest moment of every round by the size of the room for no benefit: the
 * client applies an ordered array in exactly the same loop it uses for a
 * gap-heal.
 *
 * ALWAYS call after the transaction commits -- triggering inside the tx can
 * publish an event for a rollback that never happened, leaving clients holding
 * a seq that does not exist.
 *
 * Never throws: Pusher being down must not fail a write that already
 * committed. Clients self-heal via gap detection on their next event or on
 * reconnect, so a dropped broadcast costs latency, not correctness.
 */
export async function broadcastAll(code: string, events: GameEvent[]): Promise<void> {
  if (events.length === 0) return;

  // Over Pusher's size limit this is a hint rather than the events; see
  // `broadcastPayload`, which owns that rule.
  const payload = broadcastPayload(events);

  try {
    await pusher.trigger(channelFor(code), EVENT_NAME, payload);
  } catch (err) {
    console.error("[pusher] broadcast failed; clients will self-heal", err);
  }
}

export async function broadcast(code: string, event: GameEvent): Promise<void> {
  await broadcastAll(code, [event]);
}
