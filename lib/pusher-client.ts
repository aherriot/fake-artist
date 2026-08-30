"use client";

import Pusher from "pusher-js";

let client: Pusher | null = null;
let attempted = false;

/**
 * Shared connection per tab, or null when Pusher is not configured.
 *
 * Returning null rather than throwing matters: missing or wrong Pusher keys
 * should degrade the app to polling, not blank the page. Realtime is an
 * optimisation over the database, never the source of truth.
 */
export function getPusher(): Pusher | null {
  if (attempted) return client;
  attempted = true;

  const key = process.env.NEXT_PUBLIC_PUSHER_KEY;
  const cluster = process.env.NEXT_PUBLIC_PUSHER_CLUSTER;
  if (!key || !cluster) {
    console.warn("[pusher] not configured; falling back to polling.");
    return null;
  }
  try {
    client = new Pusher(key, {
      cluster,
      channelAuthorization: { endpoint: "/api/pusher/auth", transport: "ajax" },
    });
  } catch (err) {
    console.warn("[pusher] init failed; falling back to polling.", err);
    client = null;
  }
  return client;
}

export const EVENT_NAME = "game-event";
export const channelFor = (code: string) => `presence-game-${code.toUpperCase()}`;
