"use client";

/**
 * Last-resort boundary: catches failures in the root layout itself, where
 * app/error.tsx cannot help. It must render its own <html>/<body> because
 * the layout that would normally provide them is what failed.
 *
 * Deliberately dependency-free -- no imports, no shared components -- since
 * whatever broke may well be in that shared code.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          margin: 0,
          padding: 24,
          lineHeight: 1.5,
          background: "#111",
          color: "#eee",
        }}
      >
        <main style={{ maxWidth: 560 }} role="alert">
          <h1>The app failed to load</h1>
          <p style={{ color: "#ccc" }}>
            Something broke badly enough to take down the page shell. Your game is
            unaffected -- state lives in the database.
          </p>
          <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
            <button onClick={reset} style={btn(true)}>
              Try again
            </button>
            <a href="/" style={btn(false)}>
              Go home
            </a>
          </div>
          {error.digest && (
            <p style={{ color: "#666", fontSize: 13, marginTop: 24 }}>
              Reference: <code style={{ color: "#fa0" }}>{error.digest}</code>
            </p>
          )}
        </main>
      </body>
    </html>
  );
}

const btn = (primary: boolean): React.CSSProperties => ({
  padding: "8px 16px",
  fontSize: 15,
  fontFamily: "inherit",
  cursor: "pointer",
  textDecoration: "none",
  display: "inline-block",
  background: primary ? "#2a4" : "#222",
  color: primary ? "#000" : "#eee",
  border: `1px solid ${primary ? "#2a4" : "#555"}`,
});
