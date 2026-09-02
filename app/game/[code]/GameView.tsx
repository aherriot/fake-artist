"use client";

import { useState } from "react";
import { clsx } from "clsx";
import { useGameSync } from "@/lib/useGameSync";
import { fetchJson } from "@/lib/fetch-json";
import { ErrorPanel } from "@/lib/ui/ErrorPanel";
import { Canvas } from "@/lib/ui/Canvas";
import { Button, Plaque } from "@/lib/ui/primitives";
import { MIN_PLAYERS, currentDrawer, currentPass, PASSES } from "@/lib/game/types";
import { Roster } from "./Roster";
import { Chat } from "./Chat";
import { StatusBoard } from "./StatusBoard";
import { Wordmark } from "@/lib/ui/Wordmark";
import { PhasePanel } from "./PhasePanel";

/** Phases whose panel is the point of the screen, not an aside to it. */
const RESOLVING = new Set(["guess", "guess_vote", "reveal", "complete"]);

export default function GameView({ code }: { code: string }) {
  const g = useGameSync(code.toUpperCase());
  const { sync } = g;
  const [highlight, setHighlight] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  /** Returns an error string so callers can show it next to their button. */
  async function act(body: unknown): Promise<string | null> {
    setActionError(null);
    const res = await fetchJson(`/api/games/${code.toUpperCase()}/action`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      setActionError(res.error);
      return res.error;
    }
    return null;
  }

  if (sync.error && !sync.ready) {
    return (
      <ErrorPanel
        title="Could not load the game"
        message={sync.error}
        hint="Your progress is safe — the game lives in the database, not in this tab."
        actions={[
          { label: "Try again", primary: true, onClick: g.forceResync },
          { label: "Reload page", onClick: () => window.location.reload() },
          { label: "Go home", href: "/" },
        ]}
      />
    );
  }
  if (!sync.ready) {
    // Same shape as the loaded page, so nothing jumps when it arrives.
    return (
      <main className="mx-auto max-w-6xl px-5 py-8">
        <Wordmark />
        <div className="mt-5 animate-pulse space-y-6">
          <div className="h-24 rounded-sm border border-wall-500 bg-wall-700" />
          <div
        className={clsx(
          "flex flex-col gap-6",
          "lg:grid lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start",
        )}
      >
            <div className="aspect-square w-full max-w-[34rem] rounded-sm bg-wall-700" />
            <div className="space-y-5">
              <div className="h-40 rounded-sm border border-wall-500 bg-wall-700" />
              <div className="h-56 rounded-sm border border-wall-500 bg-wall-700" />
            </div>
          </div>
        </div>
        <p className="sr-only">Loading room {code.toUpperCase()}…</p>
      </main>
    );
  }

  const { state } = sync;
  const isHost = sync.you === sync.hostId;
  const drawer = currentDrawer(state);
  const yourTurn = drawer === sync.you;
  const yourSeat = sync.players.find((p) => p.id === sync.you)?.seat ?? 0;
  const balloting = state.phase === "voting" || state.phase === "runoff";

  return (
    <main className="mx-auto max-w-6xl px-5 py-8">

      <div className="mb-5">
        <Wordmark />
      </div>
      <div className="mb-6">
        <StatusBoard sync={sync} code={code.toUpperCase()} />
      </div>

      <div
        className={clsx(
          "flex flex-col gap-6",
          "lg:grid lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start",
        )}
      >
        <section
          className={clsx(
            "lg:col-start-1 lg:row-start-1 lg:row-span-2",
            // While the ballot is open the roster IS the ballot, so it leads
            // on a phone; the drawing becomes the reference below it.
            balloting ? "order-2" : "order-1",
          )}
        >
          {/* Anything that resolves the round goes ABOVE the artwork: the
              reveal is the moment of the round and must not sit below a tall
              canvas. Turn-by-turn prompts stay below, out of the way. */}
          {RESOLVING.has(state.phase) && (
            <div className="mb-6">
              <PhasePanel game={g} act={act} isHost={isHost} />
            </div>
          )}
          {state.phase === "lobby" ? (
            <Plaque className="grid min-h-64 place-items-center text-center">
              <div>
                <p className="font-display text-3xl">Waiting to begin</p>
                <p className="mt-2 text-sm text-label-500">
                  Share the code <b className="catalogue-no">{code.toUpperCase()}</b>.{" "}
                  {sync.players.length < MIN_PLAYERS
                    ? `${sync.players.length} of ${MIN_PLAYERS} players — ${
                        MIN_PLAYERS - sync.players.length
                      } more needed.`
                    : `${sync.players.length} players, ready when you are.`}
                </p>
                {isHost ? (
                  <Button
                    variant="primary"
                    className="mt-5"
                    disabled={sync.players.length < MIN_PLAYERS || starting}
                    onClick={async () => {
                      setStarting(true);
                      await act({ type: "start_match" });
                      setStarting(false);
                    }}
                  >
                    {starting ? "Dealing roles…" : "Start the match"}
                  </Button>
                ) : (
                  <p className="mt-5 text-sm text-label-500">
                    Waiting for the host to start…
                  </p>
                )}
              </div>
            </Plaque>
          ) : (
            <Canvas
              strokes={state.strokes}
              pending={sync.pending.strokes}
              canDraw={state.phase === "drawing" && yourTurn}
              yourSeat={yourSeat}
              onSubmit={g.submitStroke}
              highlightPlayerId={highlight}
            />
          )}

          {actionError && (
            <p role="alert" className="mt-3 text-sm text-danger">{actionError}</p>
          )}
        </section>

        {/* The roster is the ballot while voting, so it leads on a phone.
            Chat always comes last: it must never sit between the ballot and
            the drawing you are voting on. */}
        <div
          className={clsx(
            "lg:col-start-2 lg:row-start-1",
            balloting ? "order-1" : "order-2",
          )}
        >
          <Roster
            game={g}
            drawer={drawer}
            onHighlight={setHighlight}
            highlight={highlight}
          />
        </div>

        <div className="order-3 lg:col-start-2 lg:row-start-2">
          <Chat game={g} />
        </div>
      </div>

      {state.phase !== "lobby" && !RESOLVING.has(state.phase) && (
        <div className="mt-6">
          <PhasePanel game={g} act={act} isHost={isHost} />
        </div>
      )}

    </main>
  );
}

const connColor = (c: string) =>
  c === "live" ? "#34c98b" : c === "error" ? "#ff5c5c" : c === "polling" ? "#56b4e9" : "#e0a020";

