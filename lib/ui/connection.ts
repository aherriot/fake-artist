"use client";

import { useSyncExternalStore } from "react";

/**
 * Whether the server is reachable.
 *
 * Every client request goes through `fetchJson`, so it is the one place that
 * knows. A single network failure is usually a blip; two in a row is worth
 * telling the user about, because otherwise a dead server looks exactly like
 * an app that has stopped responding for no reason.
 */
let failures = 0;
let down = false;
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((l) => l());

/** Consecutive failures before we say anything. */
const THRESHOLD = 2;

export function reportRequestFailed() {
  failures += 1;
  if (failures >= THRESHOLD && !down) {
    down = true;
    emit();
  }
}

export function reportRequestSucceeded() {
  failures = 0;
  if (down) {
    down = false;
    emit();
  }
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  const onOnline = () => reportRequestSucceeded();
  const onOffline = () => {
    failures = THRESHOLD;
    if (!down) {
      down = true;
      emit();
    }
  };
  if (typeof window !== "undefined") {
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
  }
  return () => {
    listeners.delete(cb);
    if (typeof window !== "undefined") {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    }
  };
}

export function useServerUnreachable(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => down,
    () => false, // never claim the server is down while rendering on it
  );
}
