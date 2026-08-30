import { cookies } from "next/headers";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

const COOKIE = "rr_player";
const MAX_AGE = 60 * 60 * 24 * 7; // 7 days -- games last ~1h, this is generous

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET is not set");
  return s;
}

function sign(id: string): string {
  return createHmac("sha256", secret()).update(id).digest("base64url");
}

function verify(value: string): string | null {
  const idx = value.lastIndexOf(".");
  if (idx <= 0) return null;
  const id = value.slice(0, idx);
  const mac = value.slice(idx + 1);
  const expected = sign(id);
  // Constant-time compare; lengths must match first or timingSafeEqual throws.
  if (mac.length !== expected.length) return null;
  if (!timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  return id;
}

/** Read the player id from the signed cookie, or null if absent/tampered. */
export async function getPlayerId(): Promise<string | null> {
  const raw = (await cookies()).get(COOKIE)?.value;
  return raw ? verify(raw) : null;
}

/**
 * Read the player id, minting and setting one if this browser has none.
 *
 * This identity is what makes reload-resume work: the cookie survives the
 * refresh, so the client comes back as the same player and simply refetches.
 * Only callable from a Route Handler / Server Action (it writes a cookie).
 */
export async function getOrCreatePlayerId(): Promise<string> {
  const jar = await cookies();
  const existing = jar.get(COOKIE)?.value;
  const verified = existing ? verify(existing) : null;
  if (verified) return verified;

  const id = randomUUID();
  jar.set(COOKIE, `${id}.${sign(id)}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE,
  });
  return id;
}
