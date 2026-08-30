"use client";

import { useEffect } from "react";
import { ErrorPanel, isStaleBundleError } from "@/lib/ui/ErrorPanel";

/**
 * Route-level error boundary.
 *
 * Its existence is the fix for "missing required error components,
 * refreshing..." -- without a boundary, Next has nothing to render when a
 * component throws, so it hard-refreshes into a loop and the user is told
 * nothing useful.
 */
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[boundary] route error:", error);
  }, [error]);

  // A stale bundle cannot be reset() away -- the chunk is genuinely gone.
  if (isStaleBundleError(error)) {
    return (
      <ErrorPanel
        title="A new version is available"
        message="This page was running an older version of the app that is no longer on the server."
        hint="Reloading picks up the current version. Nothing in your game is lost -- state lives in the database, not in this tab."
        actions={[
          { label: "Reload", primary: true, onClick: () => window.location.reload() },
          { label: "Go home", href: "/" },
        ]}
        reference={error.digest}
        detail={error.message}
      />
    );
  }

  return (
    <ErrorPanel
      title="Something went wrong"
      message="This page hit an unexpected error. Your game is safe -- all state is stored server-side, so nothing was lost."
      hint="Try again first. If it keeps happening, reload the page or head home and rejoin with your game code."
      actions={[
        { label: "Try again", primary: true, onClick: reset },
        { label: "Reload page", onClick: () => window.location.reload() },
        { label: "Go home", href: "/" },
      ]}
      reference={error.digest}
      detail={error.message}
    />
  );
}
