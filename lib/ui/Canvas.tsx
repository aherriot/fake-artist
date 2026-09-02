"use client";

import { useCallback, useRef, useState } from "react";
import { clsx } from "clsx";
import type { Stroke } from "@/lib/game/types";
import { penVar } from "./primitives";

/** Points closer together than this add nothing but weight. */
const MIN_STEP = 0.004;

const toPath = (pts: [number, number][]) =>
  pts.length === 0
    ? ""
    : `M ${pts[0][0]} ${pts[0][1]} ` +
      pts.slice(1).map(([x, y]) => `L ${x} ${y}`).join(" ");

/**
 * The artwork: a white sheet in a dark room.
 *
 * Drawn as SVG in a 0..1 viewBox rather than a raster canvas, so the same
 * normalised points render crisply at any size, on any device, and can be
 * replayed from the event log later without storing pixels.
 *
 * One continuous line per turn: pointer-down to pointer-up produces the
 * stroke, which is then PREVIEWED. Nothing is sent until Submit, so a shaky
 * trackpad or a misclick costs a redraw rather than your turn.
 */
export function Canvas({
  strokes,
  canDraw,
  yourSeat,
  onSubmit,
  highlightPlayerId,
  showSeatTags = true,
  pending,
}: {
  strokes: Stroke[];
  canDraw: boolean;
  yourSeat: number;
  onSubmit: (points: [number, number][]) => void | Promise<unknown>;
  /** Dim everything except this player's lines. */
  highlightPlayerId?: string | null;
  showSeatTags?: boolean;
  /** Your own strokes awaiting confirmation, drawn the same as the rest. */
  pending?: Stroke[];
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [draft, setDraft] = useState<[number, number][]>([]);
  const [drawing, setDrawing] = useState(false);
  const [busy, setBusy] = useState(false);

  const pointFrom = useCallback((e: React.PointerEvent): [number, number] | null => {
    const el = svgRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    // Clamp rather than reject: dragging past the edge should end at the
    // edge, not silently drop points and leave a gap in the line.
    return [Math.min(1, Math.max(0, x)), Math.min(1, Math.max(0, y))];
  }, []);

  const down = (e: React.PointerEvent) => {
    if (!canDraw || busy) return;
    const p = pointFrom(e);
    if (!p) return;
    // Capture so the line keeps following the pointer outside the sheet.
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrawing(true);
    setDraft([p]);
  };

  const move = (e: React.PointerEvent) => {
    if (!drawing) return;
    const p = pointFrom(e);
    if (!p) return;
    setDraft((prev) => {
      const last = prev[prev.length - 1];
      if (last && Math.hypot(p[0] - last[0], p[1] - last[1]) < MIN_STEP) return prev;
      return [...prev, p];
    });
  };

  const up = (e: React.PointerEvent) => {
    if (!drawing) return;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    setDrawing(false);
  };

  const submit = async () => {
    if (draft.length < 2) return;
    setBusy(true);
    await onSubmit(draft);
    setBusy(false);
    setDraft([]);
  };

  const all = [...strokes, ...(pending ?? [])];
  const hasDraft = draft.length >= 2;

  return (
    <div>
      <div
        className="relative mx-auto w-full max-w-[min(100%,34rem)] rounded-sm bg-paper"
        style={{ boxShadow: "var(--shadow-lit)" }}
      >
        <svg
          ref={svgRef}
          viewBox="0 0 1 1"
          preserveAspectRatio="none"
          className={clsx(
            "canvas-surface block aspect-square w-full select-none",
            canDraw && !busy ? "cursor-crosshair" : "cursor-default",
          )}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          role="img"
          aria-label={`Shared drawing, ${all.length} line${all.length === 1 ? "" : "s"} so far`}
        >
          {all.map((s, i) => {
            const dimmed = highlightPlayerId != null && s.playerId !== highlightPlayerId;
            return (
              <path
                key={i}
                d={toPath(s.points)}
                stroke={penVar(s.seat + 1)}
                strokeWidth={3}
                vectorEffect="non-scaling-stroke"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
                opacity={dimmed ? 0.15 : 1}
                className="transition-opacity duration-150"
              />
            );
          })}

          {/* The line you are drawing, or have drawn but not yet submitted. */}
          {draft.length >= 1 && (
            <path
              d={toPath(draft)}
              stroke={penVar(yourSeat + 1)}
              strokeWidth={3}
              vectorEffect="non-scaling-stroke"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
              opacity={drawing ? 1 : 0.7}
              strokeDasharray={drawing ? undefined : "6 4"}
            />
          )}

          {/* Seat numbers at each line's start. Colour cannot carry
              attribution alone past about eight players, so the number is the
              fact and the colour is the hint. */}
          {showSeatTags &&
            all.map((s, i) => {
              if (s.points.length === 0) return null;
              const [x, y] = s.points[0];
              const dimmed = highlightPlayerId != null && s.playerId !== highlightPlayerId;
              return (
                <g key={`t${i}`} opacity={dimmed ? 0.15 : 0.85}>
                  <circle cx={x} cy={y} r={0.022} fill={penVar(s.seat + 1)} />
                  <text
                    x={x}
                    y={y}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill="#faf7f1"
                    style={{ fontSize: 0.028, fontFamily: "var(--font-mono)" }}
                  >
                    {s.seat + 1}
                  </text>
                </g>
              );
            })}
        </svg>
      </div>

      {canDraw && (
        <div className="mt-3 flex items-center gap-3">
          <button
            onClick={submit}
            disabled={!hasDraft || busy}
            className="rounded-sm bg-accent-500 px-4 py-2 text-sm font-medium text-wall-950 transition-colors hover:bg-accent-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? "Submitting…" : "Submit line"}
          </button>
          <button
            onClick={() => setDraft([])}
            disabled={!hasDraft || busy}
            className="rounded-sm border border-wall-500 bg-wall-700 px-4 py-2 text-sm text-label-100 transition-colors hover:bg-wall-600 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Undo
          </button>
          <p className="text-xs text-label-500">
            {hasDraft
              ? "Submit to end your turn — you cannot change it afterwards."
              : "Draw one continuous line without lifting the pointer."}
          </p>
        </div>
      )}
    </div>
  );
}
