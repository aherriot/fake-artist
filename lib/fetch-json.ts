"use client";

import { reportRequestFailed, reportRequestSucceeded } from "./ui/connection";

export type FetchResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; status: number | null; requestId?: string };

const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * fetch + JSON with no way to throw.
 *
 * Every failure mode the app can hit -- offline, DNS failure, timeout, a 500
 * with an empty body, an HTML error page from a proxy -- comes back as a
 * typed result with a message worth showing. Callers never need try/catch,
 * and `JSON.parse: unexpected end of data` can no longer reach the user.
 */
export async function fetchJson<T>(
  url: string,
  init?: RequestInit & { timeoutMs?: number },
): Promise<FetchResult<T>> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...rest } = init ?? {};
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(url, { ...rest, signal: ctrl.signal });
  } catch (err) {
    clearTimeout(timer);
    // A transport failure is what "the server is unreachable" actually means;
    // an HTTP error response proves the server is alive and answering.
    reportRequestFailed();
    if (err instanceof DOMException && err.name === "AbortError")
      return { ok: false, error: `Request timed out after ${timeoutMs / 1000}s.`, status: null };
    return {
      ok: false,
      error: "Could not reach the server. Check your connection.",
      status: null,
    };
  }
  clearTimeout(timer);
  reportRequestSucceeded();

  const text = await res.text().catch(() => "");

  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      // Not JSON: a proxy error page, a truncated response, or an empty 500.
      return {
        ok: false,
        status: res.status,
        error: res.ok
          ? "Server sent a malformed response."
          : `Server error (${res.status}).`,
      };
    }
  }

  const obj = (body ?? {}) as { error?: string; requestId?: string };
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      error: obj.error ?? `Request failed (${res.status}).`,
      requestId: obj.requestId,
    };
  }
  return { ok: true, data: (body ?? {}) as T };
}
