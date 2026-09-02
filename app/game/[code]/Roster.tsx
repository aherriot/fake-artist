"use client";

import type { SyncState } from "@/lib/useGameSync";
import { Plaque, penVar } from "@/lib/ui/primitives";
import { clsx } from "clsx";

/**
 * The players, and the whole game's attribution affordance.
 *
 * Hovering a name dims every line that is not theirs. Colour alone cannot
 * separate ten players, and "whose line is that?" is the question the game
 * turns on, so this is the mechanism rather than a convenience.
 */
export function Roster({
  sync,
  drawer,
  onHighlight,
  highlight,
}: {
  sync: SyncState;
  drawer: string | null;
  onHighlight: (id: string | null) => void;
  highlight: string | null;
}) {
  const { state } = sync;
  return (
    <Plaque>
      <p className="label-caps mb-3">
        {sync.players.length} hands
        {state.phase !== "lobby" && " — hover to isolate"}
      </p>
      <ul className="space-y-1.5">
        {sync.players.map((p) => {
          const online = sync.online.has(p.id);
          const isDrawer = p.id === drawer;
          return (
            <li
              key={p.id}
              onMouseEnter={() => onHighlight(p.id)}
              onMouseLeave={() => onHighlight(null)}
              onFocus={() => onHighlight(p.id)}
              onBlur={() => onHighlight(null)}
              tabIndex={0}
              className={clsx(
                "flex items-center gap-2 rounded-sm px-1.5 py-1 text-sm outline-none",
                highlight === p.id && "bg-wall-600",
                isDrawer && "ring-1 ring-accent-500/40",
              )}
            >
              <span
                aria-hidden
                className="grid size-5 shrink-0 place-items-center rounded-[2px] font-mono text-[10px] text-wall-950"
                style={{ background: penVar(p.seat + 1) }}
              >
                {p.seat + 1}
              </span>
              <span className={online ? "text-label-100" : "text-label-700"}>{p.nickname}</span>
              <span className="ml-auto flex items-center gap-2">
                {state.scores[p.id] > 0 && (
                  <span className="catalogue-no">{state.scores[p.id]}</span>
                )}
                {p.id === sync.hostId && <span className="label-caps">Host</span>}
                {p.id === sync.you && <span className="label-caps">You</span>}
                {isDrawer && <span className="label-caps text-accent-400">Drawing</span>}
                {(state.phase === "voting" || state.phase === "runoff") &&
                  state.voted.includes(p.id) && (
                    <span className="label-caps text-success">Voted</span>
                  )}
                {!online && <span className="label-caps text-label-700">Away</span>}
              </span>
            </li>
          );
        })}
      </ul>
    </Plaque>
  );
}
