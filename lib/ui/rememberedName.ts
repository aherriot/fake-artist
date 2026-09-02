/**
 * Remembers the player's name on this device.
 *
 * Deliberately localStorage and not a cookie: it is a convenience for the
 * person at this browser, never something the server should see or trust.
 * Identity is the signed httpOnly cookie; this is only a saved typing.
 *
 * Every access is wrapped, because localStorage is not merely absent in some
 * contexts -- it THROWS on access in private windows and where the user has
 * blocked site data. An unguarded read there takes the whole page down, which
 * would be an absurd way to lose a game over a remembered nickname.
 */
const KEY = "fake-artist:nickname";
export const MAX_NAME = 24;

export function loadNickname(): string {
  try {
    if (typeof window === "undefined") return "";
    return (window.localStorage.getItem(KEY) ?? "").slice(0, MAX_NAME);
  } catch {
    return "";
  }
}

export function saveNickname(name: string): void {
  try {
    if (typeof window === "undefined") return;
    const trimmed = name.trim().slice(0, MAX_NAME);
    if (trimmed) window.localStorage.setItem(KEY, trimmed);
  } catch {
    // Private window, blocked site data, or a full quota. Not worth a word to
    // the user: the name simply is not remembered next time.
  }
}

export function forgetNickname(): void {
  try {
    if (typeof window !== "undefined") window.localStorage.removeItem(KEY);
  } catch {
    /* nothing to do */
  }
}
