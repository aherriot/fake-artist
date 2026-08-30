"use client";

export interface Action {
  label: string;
  onClick?: () => void;
  href?: string;
  primary?: boolean;
}

/**
 * The one place failure is rendered.
 *
 * Rules it exists to enforce:
 *  - say what happened in plain language, never a stack or a framework string
 *  - always offer the next action, with the most useful one first
 *  - keep the technical detail available but collapsed, with a reference the
 *    user can quote and we can grep for in the server log
 */
export function ErrorPanel({
  title,
  message,
  hint,
  actions,
  reference,
  detail,
}: {
  title: string;
  message: string;
  hint?: string;
  actions: Action[];
  reference?: string;
  detail?: string;
}) {
  return (
    <main style={{ maxWidth: 560 }} role="alert">
      <h1 style={{ marginBottom: 8 }}>{title}</h1>
      <p style={{ color: "#ccc", marginTop: 0 }}>{message}</p>
      {hint && <p style={{ color: "#888", fontSize: 14 }}>{hint}</p>}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 20 }}>
        {actions.map((a) =>
          a.href ? (
            <a key={a.label} href={a.href} style={btn(a.primary)}>
              {a.label}
            </a>
          ) : (
            <button key={a.label} onClick={a.onClick} style={btn(a.primary)}>
              {a.label}
            </button>
          ),
        )}
      </div>

      {(reference || detail) && (
        <details style={{ marginTop: 24 }}>
          <summary style={{ color: "#666", cursor: "pointer", fontSize: 13 }}>
            Technical details
          </summary>
          {reference && (
            <p style={{ color: "#888", fontSize: 13 }}>
              Reference: <code style={{ color: "#fa0" }}>{reference}</code>
            </p>
          )}
          {detail && (
            <pre
              style={{
                color: "#888",
                fontSize: 12,
                background: "#000",
                border: "1px solid #333",
                padding: 10,
                overflowX: "auto",
                whiteSpace: "pre-wrap",
              }}
            >
              {detail}
            </pre>
          )}
        </details>
      )}
    </main>
  );
}

const btn = (primary?: boolean): React.CSSProperties => ({
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

/**
 * A stale-bundle error: the page is running code whose chunks no longer
 * exist, typically right after a deploy (or a dev rebuild). `reset()` cannot
 * fix it because the missing chunk is still missing -- only a hard reload can.
 */
export function isStaleBundleError(err: { message?: string; name?: string }): boolean {
  const s = `${err?.name ?? ""} ${err?.message ?? ""}`;
  return /ChunkLoadError|Loading chunk|dynamically imported module|missing required error components/i.test(
    s,
  );
}
