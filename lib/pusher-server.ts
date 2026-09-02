import Pusher from "pusher";
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
 * Fan out one event. ALWAYS call after the transaction commits -- triggering
 * inside the tx can publish an event for a rollback that never happened,
 * leaving clients holding a seq that does not exist.
 *
 * Never throws: Pusher being down must not fail a write that already
 * committed. Clients self-heal via gap detection on their next event or on
 * reconnect, so a dropped broadcast costs latency, not correctness.
 */
export async function broadcastAll(code: string, events: GameEvent[]): Promise<void> {
  for (const e of events) await broadcast(code, e);
}

export async function broadcast(code: string, event: GameEvent): Promise<void> {
  try {
    await pusher.trigger(channelFor(code), EVENT_NAME, event);
  } catch (err) {
    console.error("[pusher] broadcast failed; clients will self-heal", err);
  }
}
