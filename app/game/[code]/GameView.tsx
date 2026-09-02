"use client";

import { useState } from "react";
import { useGameSync } from "@/lib/useGameSync";
import { ErrorPanel } from "@/lib/ui/ErrorPanel";
import { Canvas } from "@/lib/ui/Canvas";
import { Button, Pill, Plaque, WallLabel, penVar } from "@/lib/ui/primitives";
import { hasVoted, isReady } from "@/lib/game/optimistic";
import { MIN_PLAYERS, currentDrawer, currentPass, PASSES } from "@/lib/game/types";
import { RoleCard } from "./RoleCard";
import { Roster } from "./Roster";
import { Chat } from "./Chat";
import { PhasePanel } from "./PhasePanel";

/** Phases whose panel is the point of the screen, not an aside to it. */
const RESOLVING = new Set(["guess", "guess_vote", "reveal", "complete"]);

export default function GameView({ code }: { code: string }) {
  const g = useGameSync(code.toUpperCase());
  const { sync } = g;
  const [highlight, setHighlight] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function act(body: unknown) {
    setActionError(null);
    const res = await fetch(`/api/games/${code.toUpperCase()}/action`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setActionError(d.error ?? "Action failed");
    }
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
  if (!sync.ready) return <main className="p-8 text-label-500">Loading {code.toUpperCase()}…</main>;

  const { state } = sync;
  const isHost = sync.you === sync.hostId;
  const drawer = currentDrawer(state);
  const yourTurn = drawer === sync.you;
  const yourSeat = sync.players.find((p) => p.id === sync.you)?.seat ?? 0;

  return (
    <main className="mx-auto max-w-6xl px-5 py-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <WallLabel
          title={state.category ?? "A Fake Artist Goes to New York"}
          medium={
            state.phase === "lobby"
              ? "Waiting for players"
              : `${sync.players.length} hands, ink on paper — round ${state.round} of ${state.totalRounds}`
          }
          catalogue={code.toUpperCase()}
          status={<PhaseBadge phase={state.phase} yourTurn={yourTurn} />}
        />
        <div className="flex items-center gap-3 text-xs text-label-500">
          <span>
            conn{" "}
            <b style={{ color: connColor(sync.conn) }}>{sync.conn}</b>
          </span>
          <span>seq <b className="text-label-300">{sync.lastSeq}</b></span>
          <button onClick={g.forceResync} className="underline hover:text-label-300">
            resync
          </button>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section>
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
                    disabled={sync.players.length < MIN_PLAYERS}
                    onClick={() => act({ type: "start_match" })}
                  >
                    Start the match
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

        <aside className="space-y-5">
          {state.phase !== "lobby" && !RESOLVING.has(state.phase) && <RoleCard sync={sync} />}
          <Roster
            sync={sync}
            drawer={drawer}
            onHighlight={setHighlight}
            highlight={highlight}
          />
          <Chat game={g} />
        </aside>
      </div>

      {state.phase !== "lobby" && !RESOLVING.has(state.phase) && (
        <div className="mt-6">
          <PhasePanel game={g} act={act} isHost={isHost} />
        </div>
      )}

      {state.phase === "drawing" && (
        <p className="mt-6 text-xs text-label-500">
          Pass {currentPass(state)} of {PASSES}
          {drawer && (
            <>
              {" — "}
              <span style={{ color: penVar((sync.players.find((p) => p.id === drawer)?.seat ?? 0) + 1) }}>
                {sync.players.find((p) => p.id === drawer)?.nickname}
              </span>
              {" is drawing"}
            </>
          )}
        </p>
      )}
    </main>
  );
}

function PhaseBadge({ phase, yourTurn }: { phase: string; yourTurn: boolean }) {
  if (phase === "drawing" && yourTurn) return <Pill tone="accent">Your turn</Pill>;
  const map: Record<string, { tone: "neutral" | "accent" | "success" | "warning"; label: string }> = {
    lobby: { tone: "neutral", label: "Lobby" },
    drawing: { tone: "neutral", label: "Drawing" },
    discussion: { tone: "warning", label: "Discussion" },
    voting: { tone: "warning", label: "Voting" },
    runoff: { tone: "warning", label: "Runoff" },
    guess: { tone: "accent", label: "The guess" },
    guess_vote: { tone: "accent", label: "Judging the guess" },
    reveal: { tone: "success", label: "Attributed" },
    complete: { tone: "success", label: "Match over" },
  };
  const m = map[phase] ?? { tone: "neutral" as const, label: phase };
  return <Pill tone={m.tone}>{m.label}</Pill>;
}

const connColor = (c: string) =>
  c === "live" ? "#34c98b" : c === "error" ? "#ff5c5c" : c === "polling" ? "#56b4e9" : "#e0a020";

export { isReady, hasVoted };
