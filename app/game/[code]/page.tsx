"use client";

import { use, useCallback, useEffect, useState } from "react";
import GameView from "./GameView";
import { fetchJson } from "@/lib/fetch-json";
import { ErrorPanel } from "@/lib/ui/ErrorPanel";
import { Button, Field, Plaque } from "@/lib/ui/primitives";
import { Wordmark } from "@/lib/ui/Wordmark";
import { loadNickname, saveNickname } from "@/lib/ui/rememberedName";
import type { Snapshot } from "@/lib/game/types";

type Gate =
  | { kind: "checking" }
  | { kind: "member" }
  | { kind: "stranger"; status: Snapshot["status"]; players: number }
  | { kind: "missing" }
  | { kind: "error"; message: string; requestId?: string };

/**
 * Membership gate for /game/[code].
 *
 * Someone following a shared link has no cookie and has not joined, so they
 * cannot authorise the presence-channel subscription that useGameSync opens
 * before its first fetch. Resolving membership FIRST means we either prompt
 * for a nickname or mount the live view -- never mount it and 401.
 *
 * The extra round trip costs members one cheap request and buys the
 * subscribe-before-snapshot ordering that keeps their sync race-free.
 */
export default function GamePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const upper = code.toUpperCase();

  const [gate, setGate] = useState<Gate>({ kind: "checking" });
  const [nickname, setNickname] = useState("");
  const [busy, setBusy] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [remembered, setRemembered] = useState(false);

  // After mount only: the server has no localStorage to read.
  useEffect(() => {
    const saved = loadNickname();
    if (!saved) return;
    setNickname((current) => {
      if (current) return current;
      setRemembered(true);
      return saved;
    });
  }, []);

  const check = useCallback(async (attempt = 0): Promise<void> => {
    const res = await fetchJson<Snapshot>(`/api/games/${upper}/state`);
    if (!res.ok) {
      // A bad code is a dead end; a network blip is not. Only the latter is
      // worth retrying, and doing it silently spares the user a button press.
      if (res.status === 404) {
        setGate({ kind: "missing" });
        return;
      }
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 400 * 2 ** attempt));
        return check(attempt + 1);
      }
      setGate({ kind: "error", message: res.error, requestId: res.requestId });
      return;
    }
    setGate(
      res.data.isPlayer
        ? { kind: "member" }
        : { kind: "stranger", status: res.data.status, players: res.data.players.length },
    );
  }, [upper]);

  useEffect(() => {
    void check();
  }, [check]);

  const retry = useCallback(() => {
    setGate({ kind: "checking" });
    void check();
  }, [check]);

  async function join() {
    if (!nickname.trim()) {
      setJoinError("Enter a name so the room knows who you are.");
      return;
    }
    setBusy(true);
    setJoinError(null);
    const res = await fetchJson<{ ok: boolean }>(`/api/games/${upper}/join`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nickname }),
    });
    setBusy(false);
    if (!res.ok) {
      setJoinError(res.requestId ? `${res.error} (ref ${res.requestId})` : res.error);
      return;
    }
    saveNickname(nickname);
    setGate({ kind: "member" });
  }

  if (gate.kind === "checking") {
    return (
      <main className="mx-auto max-w-lg px-6 py-16">
        <Wordmark />
        <div className="mt-10 animate-pulse space-y-4">
          <div className="h-8 w-2/3 rounded-sm bg-wall-700" />
          <div className="h-40 rounded-sm border border-wall-500 bg-wall-700" />
        </div>
        <p className="sr-only">Checking room {upper}…</p>
      </main>
    );
  }

  if (gate.kind === "missing") {
    return (
      <ErrorPanel
        title="No game with that code"
        message={`We could not find a game called ${upper}. It may have finished and been cleaned up, or the code may have a typo.`}
        hint="Codes are 6 characters and never use the letters O or I, or the digits 0 or 1."
        actions={[
          { label: "Start a new game", primary: true, href: "/" },
          { label: "Try again", onClick: retry },
        ]}
      />
    );
  }

  if (gate.kind === "error") {
    return (
      <ErrorPanel
        title="Could not load the game"
        message={gate.message}
        hint="This is usually temporary. Your game is safe -- all state is stored server-side."
        actions={[
          { label: "Try again", primary: true, onClick: retry },
          { label: "Go home", href: "/" },
        ]}
        reference={gate.requestId}
      />
    );
  }

  if (gate.kind === "stranger") {
    const closed = gate.status !== "lobby";
    return (
      <main className="mx-auto max-w-lg px-6 py-16">
        <Wordmark size="full" asLink={false} />

        <Plaque className="mt-10">
          <p className="catalogue-no">You have been invited to</p>
          <p className="mt-1 font-mono text-3xl tracking-[0.3em]">{upper}</p>

          {closed ? (
            <>
              <p className="mt-5 text-sm text-danger">
                This match is already {gate.status} and cannot take new players.
              </p>
              <p className="mt-2 text-sm text-label-500">
                Ask the host for a new room, or start your own.
              </p>
              <Button variant="primary" href="/" className="mt-5" asChild>
                Start a room
              </Button>
            </>
          ) : (
            <>
              <p className="mt-4 text-sm text-label-300">
                {gate.players} {gate.players === 1 ? "player is" : "players are"} waiting.
                Everyone draws one line of the same picture — except one of you, who has not
                been told what it is.
              </p>
              <div className="mt-6">
                <Field
                  label="Your name"
                  required
                  autoFocus
                  value={nickname}
                  maxLength={24}
                  placeholder="e.g. Hopper"
                  error={joinError}
                  hint={
                    remembered
                      ? "Remembered on this device. Change it if you like."
                      : "Everyone in the room will see this."
                  }
                  onChange={(e) => {
                    setNickname(e.target.value);
                    setRemembered(false);
                    if (joinError) setJoinError(null);
                  }}
                  onKeyDown={(e) => e.key === "Enter" && !busy && join()}
                />
              </div>
              <Button
                variant="primary"
                onClick={join}
                disabled={busy}
                className="mt-4 w-full justify-center"
              >
                {busy ? "Joining…" : "Join the room"}
              </Button>
            </>
          )}
        </Plaque>

        <p className="mt-6 text-xs text-label-500">
          No account needed. Your name is stored only for this game.
        </p>
      </main>
    );
  }

  return <GameView code={upper} />;
}
