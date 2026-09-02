"use client";

import { clsx } from "clsx";
import type { SyncState } from "@/lib/useGameSync";
import { turnStatus } from "@/lib/game/status";
import { currentPass, PASSES } from "@/lib/game/types";
import { useServerUnreachable } from "@/lib/ui/connection";

/**
 * One board above the artwork answering both questions at once:
 * what do I know, and what must I do?
 *
 * These used to be two places -- a wall label at the top and a role card off
 * in the sidebar -- and neither said whose move it was. The call to action is
 * the loudest thing here on purpose: in a turn-based game played over voice,
 * "is it me?" is the question people ask out loud most often.
 */
export function StatusBoard({ sync, code }: { sync: SyncState; code: string }) {
  const { state } = sync;
  const status = turnStatus({
    state,
    you: sync.you,
    hostId: sync.hostId,
    players: sync.players,
    privateState: sync.privateState,
    voted: sync.pending.voted,
  });
  // Pusher can still be "live" while the API is unreachable -- they are
  // different services. Showing "live" beside a "can't reach the server"
  // banner reads as a contradiction, so the worse of the two wins.
  const serverDown = useServerUnreachable();
  const conn = serverDown ? "offline" : sync.conn;
  const priv = sync.privateState;
  const fake = priv?.role === "fake";
  const inRound = state.phase !== "lobby" && state.phase !== "complete";

  return (
    <div
      className={clsx(
        "rounded-sm border bg-wall-700 transition-colors",
        status.yours ? "border-accent-500/60" : "border-wall-500",
      )}
      style={{ boxShadow: "var(--shadow-plaque)" }}
    >
      {/* Meta strip: everything you rarely need, kept out of the way. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-wall-500 px-4 py-2 text-[11px]">
        <span className="catalogue-no">{code}</span>
        {inRound && (
          <span className="label-caps">
            Round {state.round} of {state.totalRounds}
          </span>
        )}
        {state.phase === "drawing" && (
          <span className="label-caps">
            Pass {currentPass(state)} of {PASSES}
          </span>
        )}
        <span className="label-caps">{PHASE_LABEL[state.phase] ?? state.phase}</span>
        <span className="ml-auto flex items-center gap-3 text-label-700">
          <span>
            <span style={{ color: connColor(conn) }}>●</span> {conn}
          </span>
          <span>seq {sync.lastSeq}</span>
        </span>
      </div>

      <div className="grid gap-4 px-4 py-4 sm:grid-cols-[1fr_auto] sm:items-center">
        {/* The call to action. Loudest thing on the page when it is yours. */}
        <div className={clsx("border-l-2 pl-3", status.yours ? "border-accent-500" : "border-wall-500")}>
          <p
            className={clsx(
              "font-display leading-tight",
              status.yours ? "text-2xl text-accent-400" : "text-xl text-label-300",
            )}
          >
            {status.yours && <span aria-hidden className="mr-1">▸</span>}
            {status.headline}
          </p>
          {status.detail && <p className="mt-1 text-sm text-label-500">{status.detail}</p>}
        </div>

        {/* What only you know. */}
        {inRound && priv && (
          <div className="sm:max-w-xs sm:text-right">
            <p className="label-caps">
              {fake ? "You are the fake artist" : "The subject"}
            </p>
            {fake ? (
              <>
                <p className="mt-0.5 font-display text-2xl text-accent-400">
                  You don&apos;t know it
                </p>
                <p className="mt-1 text-xs text-label-500">
                  All you have: <span className="text-label-300">{state.category}</span>
                </p>
              </>
            ) : (
              <>
                <p className="mt-0.5 font-display text-2xl">{priv.topic}</p>
                <p className="mt-1 text-xs text-label-500">{state.category}</p>
              </>
            )}
          </div>
        )}

        {/* In the lobby there is no secret yet, so show the room code big. */}
        {state.phase === "lobby" && (
          <div className="sm:text-right">
            <p className="label-caps">Room code</p>
            <p className="mt-0.5 font-mono text-2xl tracking-[0.3em]">{code}</p>
          </div>
        )}
      </div>
    </div>
  );
}

const PHASE_LABEL: Record<string, string> = {
  lobby: "Lobby",
  drawing: "Drawing",
  voting: "Voting",
  runoff: "Runoff",
  guess: "The guess",
  guess_vote: "Judging the guess",
  reveal: "Attributed",
  complete: "Match over",
};

const connColor = (c: string) =>
  c === "live"
    ? "#34c98b"
    : c === "error" || c === "offline"
      ? "#ff5c5c"
      : c === "polling"
        ? "#56b4e9"
        : "#e0a020";
