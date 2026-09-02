"use client";

import { clsx } from "clsx";
import type { PlayerInfo } from "@/lib/game/types";
import { penTextVar } from "./primitives";

/**
 * A player's name, in their own pen colour.
 *
 * Used everywhere a name appears in prose, so that "the room accused Cara" and
 * the green line on the canvas are visibly the same person. Colour is a
 * reinforcement here rather than the identifier -- the name is written out, so
 * nothing is lost if two hues read alike or the reader cannot tell them apart.
 */
export function PlayerName({
  id,
  players,
  fallback = "someone",
  bold = true,
  className,
}: {
  id: string | null | undefined;
  players: PlayerInfo[];
  fallback?: string;
  bold?: boolean;
  className?: string;
}) {
  const player = id ? players.find((p) => p.id === id) : undefined;
  if (!player) return <span className={className}>{fallback}</span>;
  return (
    <span
      className={clsx(bold && "font-medium", className)}
      style={{ color: penTextVar(player.seat + 1) }}
    >
      {player.nickname}
    </span>
  );
}

/** The same, for a list: "Alice", "Alice and Bob", "Alice, Bob and 2 others". */
export function PlayerNames({
  ids,
  players,
  max = 3,
}: {
  ids: string[];
  players: PlayerInfo[];
  max?: number;
}) {
  if (ids.length === 0) return <span>everyone</span>;
  const shown = ids.slice(0, max);
  const rest = ids.length - shown.length;
  return (
    <>
      {shown.map((id, i) => (
        <span key={id}>
          {i > 0 && (i === shown.length - 1 && rest === 0 ? " and " : ", ")}
          <PlayerName id={id} players={players} />
        </span>
      ))}
      {rest > 0 && ` and ${rest} other${rest === 1 ? "" : "s"}`}
    </>
  );
}
