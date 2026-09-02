"use client";

import { clsx } from "clsx";
import type { ReactNode } from "react";

export const PEN_COUNT = 10;
/** Seat -> pen colour, as ink on paper. For strokes and swatches. */
export const penVar = (seat: number) => `var(--color-pen-${((seat - 1) % PEN_COUNT) + 1})`;

/**
 * Seat -> the same identity as TEXT on the dark UI.
 *
 * Never use `penVar` for text: those values are tuned for white paper and six
 * of the ten fail contrast against the wall, seat 8 invisibly so.
 */
export const penTextVar = (seat: number) =>
  `var(--color-pen-${((seat - 1) % PEN_COUNT) + 1}-ui)`;

/* ------------------------------------------------------------------ Button */

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

/**
 * The accent is the loudest thing in the room, so exactly one primary button
 * should exist per screen. Everything else is secondary or ghost.
 */
export function Button({
  variant = "secondary",
  size = "md",
  className,
  href,
  asChild,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: "sm" | "md";
  /** Render as a link, for navigation that happens to look like a button. */
  href?: string;
  asChild?: boolean;
}) {
  const classes = clsx(
    "inline-flex items-center justify-center gap-2 rounded-sm font-medium",
    "transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40",
    size === "sm" ? "px-3 py-1.5 text-[13px]" : "px-4 py-2 text-sm",
    variant === "primary" && "bg-accent-500 text-wall-950 hover:bg-accent-400 active:bg-accent-600",
    variant === "secondary" &&
      "border border-wall-500 bg-wall-700 text-label-100 hover:border-wall-400 hover:bg-wall-600",
    variant === "ghost" && "text-label-300 hover:bg-wall-700 hover:text-label-100",
    variant === "danger" && "border border-danger/40 bg-transparent text-danger hover:bg-danger/10",
    className,
  );
  if (href) {
    return (
      <a href={href} className={classes}>
        {props.children}
      </a>
    );
  }
  return (
    <button
      className={clsx(
        "inline-flex items-center justify-center gap-2 rounded-sm font-medium",
        "transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40",
        size === "sm" ? "px-3 py-1.5 text-[13px]" : "px-4 py-2 text-sm",
        variant === "primary" &&
          "bg-accent-500 text-wall-950 hover:bg-accent-400 active:bg-accent-600",
        variant === "secondary" &&
          "border border-wall-500 bg-wall-700 text-label-100 hover:border-wall-400 hover:bg-wall-600",
        variant === "ghost" && "text-label-300 hover:bg-wall-700 hover:text-label-100",
        variant === "danger" &&
          "border border-danger/40 bg-transparent text-danger hover:bg-danger/10",
        className,
      )}
      {...props}
    />
  );
}

/* -------------------------------------------------------------- Wall label */

/**
 * The signature element. Museum wall labels carry title, medium, and
 * catalogue number in a fixed hierarchy -- and "attribution" happens to be
 * both the art-historical term and this game's core mechanic.
 */
export function WallLabel({
  title,
  medium,
  catalogue,
  status,
}: {
  title: string;
  medium?: string;
  catalogue?: string;
  status?: ReactNode;
}) {
  return (
    <div className="border-l-2 border-wall-500 pl-4">
      <h3 className="font-display text-2xl leading-tight text-label-100">{title}</h3>
      {medium && <p className="mt-1 text-sm italic text-label-500">{medium}</p>}
      {(catalogue || status) && (
        <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          {catalogue && <span className="catalogue-no">Cat. no. {catalogue}</span>}
          {status}
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------- Frame */

/** The lit artwork: the only light source in a dark room. */
export function Frame({
  children,
  className,
}: {
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={clsx("rounded-sm bg-paper shadow-lit", className)}
      style={{ boxShadow: "var(--shadow-lit)" }}
    >
      {children}
    </div>
  );
}

/* ---------------------------------------------------------------- Identity */

/**
 * A player's identity chip.
 *
 * The seat number is always rendered alongside the colour, never instead of
 * it. Past about eight categories no palette stays reliably distinguishable,
 * so colour is a hint here and the number is the fact.
 */
export function PlayerChip({
  seat,
  name,
  online = true,
  you = false,
  host = false,
  className,
}: {
  seat: number;
  name: string;
  online?: boolean;
  you?: boolean;
  host?: boolean;
  className?: string;
}) {
  return (
    <span className={clsx("flex items-center gap-2", className)}>
      <span
        aria-hidden
        className="grid size-5 shrink-0 place-items-center rounded-[2px] font-mono text-[10px] font-medium text-wall-950"
        style={{ background: penVar(seat) }}
      >
        {seat}
      </span>
      <span className={clsx("text-sm", online ? "text-label-100" : "text-label-700")}>
        {name}
      </span>
      <span className="ml-auto flex items-center gap-2">
        {host && <span className="label-caps">Host</span>}
        {you && <span className="label-caps">You</span>}
        {!online && <span className="label-caps text-label-700">Away</span>}
      </span>
    </span>
  );
}

/* ------------------------------------------------------------------ Status */

export function Pill({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "accent" | "success" | "warning" | "danger";
  children: ReactNode;
}) {
  return (
    <span
      className={clsx(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium tracking-[0.08em] uppercase",
        tone === "neutral" && "bg-wall-700 text-label-300 ring-1 ring-wall-500",
        tone === "accent" && "bg-accent-500/15 text-accent-400 ring-1 ring-accent-500/30",
        tone === "success" && "bg-success/15 text-success ring-1 ring-success/30",
        tone === "warning" && "bg-warning/15 text-warning ring-1 ring-warning/30",
        tone === "danger" && "bg-danger/15 text-danger ring-1 ring-danger/30",
      )}
    >
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------- Field */

/**
 * A labelled input.
 *
 * `error` is deliberately prominent. A disabled button with no explanation is
 * the worst possible feedback -- the user cannot tell what is missing, and a
 * screen reader is told nothing at all. Prefer leaving actions enabled and
 * surfacing the specific problem here.
 */
export function Field({
  label,
  hint,
  error,
  required = false,
  mono = false,
  id,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: string;
  error?: string | null;
  required?: boolean;
  mono?: boolean;
}) {
  const inputId = id ?? `f-${label.replace(/\s+/g, "-").toLowerCase()}`;
  const describedBy = error ? `${inputId}-err` : hint ? `${inputId}-hint` : undefined;
  return (
    <div className="block">
      <label htmlFor={inputId} className="label-caps flex items-center gap-2">
        {label}
        {required && <span className="text-accent-500 normal-case tracking-normal">required</span>}
      </label>
      <input
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={clsx(
          "mt-1.5 block w-full rounded-sm border bg-wall-900 px-3 py-2",
          "text-label-100 placeholder:text-label-700 focus:outline-none",
          error
            ? "border-danger focus:border-danger"
            : "border-wall-500 focus:border-accent-500",
          mono && "font-mono tracking-[0.2em] uppercase",
        )}
        {...props}
      />
      {error ? (
        <p id={`${inputId}-err`} role="alert" className="mt-1.5 text-xs text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${inputId}-hint`} className="mt-1.5 text-xs text-label-500">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ Plaque */

/** A raised surface. Gallery plaques, not cards with rounded bubbles. */
export function Plaque({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={clsx(
        "rounded-sm border border-wall-500 bg-wall-700 p-5",
        className,
      )}
      style={{ boxShadow: "var(--shadow-plaque)" }}
    >
      {children}
    </div>
  );
}
