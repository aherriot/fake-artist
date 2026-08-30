"use client";

import { useState } from "react";
import { useGameSync } from "@/lib/useGameSync";
import { ErrorPanel } from "@/lib/ui/ErrorPanel";
import { GRID_SIZE, ROUNDS, TILE_COUNT } from "@/lib/game/types";

const COLORS = ["#e05", "#0a8", "#58f", "#fa0", "#a5f", "#5fa"];

/**
 * The live game. Mounted ONLY once membership is confirmed, because
 * useGameSync subscribes to the presence channel before fetching the
 * snapshot -- and a non-member cannot authorise that subscription.
 */
export default function GameView({ code }: { code: string }) {
  const { sync, forceResync, refetchPrivate } = useGameSync(code.toUpperCase());
  const [text, setText] = useState("");
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

  /** Submit this round's SECRET pick. Nothing about it is broadcast. */
  async function commit(tile: number) {
    setActionError(null);
    const res = await fetch(`/api/games/${code.toUpperCase()}/commit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tile }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setActionError(d.error ?? "Commit failed");
    }
    await refetchPrivate();
  }

  async function send() {
    const msg = text.trim();
    if (!msg) return;
    setText("");
    await fetch(`/api/games/${code.toUpperCase()}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: msg }),
    });
  }

  if (sync.error && !sync.ready) {
    return (
      <ErrorPanel
        title="Could not load the game"
        message={sync.error}
        hint="Your progress is safe -- the game lives in the database, not in this tab."
        actions={[
          { label: "Try again", primary: true, onClick: forceResync },
          { label: "Reload page", onClick: () => window.location.reload() },
          { label: "Go home", href: "/" },
        ]}
      />
    );
  }
  if (!sync.ready) return <main>Loading {code.toUpperCase()}...</main>;

  const isHost = sync.you === sync.hostId;
  const seatOf = (id: string) => sync.players.find((p) => p.id === id)?.seat ?? 0;
  const colorOf = (id: string) => COLORS[seatOf(id) % COLORS.length];

  return (
    <main style={{ maxWidth: 760 }}>
      <h1 style={{ marginBottom: 0 }}>
        Game <span style={{ letterSpacing: 4 }}>{code.toUpperCase()}</span>
      </h1>
      <p style={{ color: "#888", marginTop: 4 }}>
        Share this code. Status: <strong>{sync.status}</strong>
      </p>

      {/* Debug strip -- this is a test harness, so the sync internals are the UI. */}
      <div style={debugStrip}>
        <span>conn: <b style={{ color: connColor(sync.conn) }}>{sync.conn}</b></span>
        <span>lastSeq: <b>{sync.lastSeq}</b></span>
        <span>resyncs: <b>{sync.resyncs}</b></span>
        <span>online: <b>{sync.online.size}/{sync.players.length}</b></span>
        <button onClick={forceResync} style={miniBtn}>force resync</button>
      </div>

      <section style={{ display: "flex", gap: 32, marginTop: 24, flexWrap: "wrap" }}>
        <div>
          <h2 style={h2}>Players</h2>
          <ul style={{ listStyle: "none", padding: 0 }}>
            {sync.players.map((p) => (
              <li key={p.id} style={{ marginBottom: 4 }}>
                <span style={{ color: colorOf(p.id) }}>&#9632;</span>{" "}
                {p.nickname}
                {p.id === sync.hostId && <span style={{ color: "#888" }}> (host)</span>}
                {p.id === sync.you && <span style={{ color: "#888" }}> (you)</span>}
                <span style={{ color: sync.online.has(p.id) ? "#0a8" : "#666" }}>
                  {sync.online.has(p.id) ? " online" : " offline"}
                </span>
                <span style={{ color: "#888" }}> -- {sync.state.scores[p.id] ?? 0}</span>
                {sync.status === "active" && sync.state.committed.includes(p.id) && (
                  <span style={{ color: "#fa0" }}> committed</span>
                )}
              </li>
            ))}
          </ul>

          {sync.status === "lobby" && isHost && (
            <button
              onClick={() => act({ type: "start_game" })}
              disabled={sync.players.length < 2}
              style={miniBtn}
            >
              Start game ({sync.players.length}/2 min)
            </button>
          )}
          {sync.status === "lobby" && !isHost && (
            <p style={{ color: "#888" }}>Waiting for host to start...</p>
          )}
        </div>

        <div>
          <h2 style={h2}>
            Board -- round {Math.min(sync.state.round, ROUNDS)}/{ROUNDS}{" "}
            {sync.status === "complete" && <span style={{ color: "#0a8" }}>-- finished</span>}
          </h2>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: `repeat(${GRID_SIZE}, 56px)`,
              gap: 4,
            }}
          >
            {Array.from({ length: TILE_COUNT }, (_, i) => {
              const owner = sync.state.tiles[i];
              const inHand = sync.privateState?.hand.includes(i) ?? false;
              const isPending = sync.privateState?.pending === i;
              return (
                <div
                  key={i}
                  title={
                    owner
                      ? `claimed by ${sync.players.find((p) => p.id === owner)?.nickname}`
                      : `tile ${i}`
                  }
                  style={{
                    height: 56,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    // A dashed outline marks tiles in YOUR hand -- visible only
                    // to you, because no one else's hand is ever sent here.
                    border: isPending
                      ? "2px solid #fa0"
                      : inHand
                        ? "2px dashed #888"
                        : "1px solid #333",
                    background: owner ? colorOf(owner) : "#1a1a1a",
                    color: owner ? "#000" : "#555",
                    fontSize: 12,
                  }}
                >
                  {owner ? "" : i}
                </div>
              );
            })}
          </div>
          {actionError && <p style={{ color: "#f66" }}>{actionError}</p>}
        </div>

        {sync.status === "active" && sync.privateState && (
          <div>
            <h2 style={h2}>Your hand (secret)</h2>
            <p style={{ color: "#666", fontSize: 13, maxWidth: 220 }}>
              Only you can see this. It is stored in your own <code>player_state</code>{" "}
              row and never enters the event log.
            </p>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {sync.privateState.hand.map((t) => (
                <button
                  key={t}
                  onClick={() => commit(t)}
                  disabled={sync.privateState?.pending !== null}
                  style={{
                    ...miniBtn,
                    minWidth: 44,
                    borderColor: sync.privateState?.pending === t ? "#fa0" : "#555",
                    opacity: sync.privateState?.pending !== null ? 0.5 : 1,
                  }}
                >
                  {t}
                </button>
              ))}
              {sync.privateState.hand.length === 0 && (
                <span style={{ color: "#666" }}>Hand empty.</span>
              )}
            </div>
            <p style={{ marginTop: 10, color: "#888", fontSize: 13 }}>
              {sync.privateState.pending !== null
                ? `Committed ${sync.privateState.pending}. Waiting for others...`
                : "Pick a tile to commit."}
            </p>
            <p style={{ color: "#888", fontSize: 13 }}>
              Committed: {sync.state.committed.length}/{sync.players.length}
            </p>
          </div>
        )}
      </section>

      <section style={{ marginTop: 32 }}>
        <h2 style={h2}>Chat</h2>
        <div style={chatBox}>
          {sync.chat.length === 0 && <p style={{ color: "#666" }}>No messages yet.</p>}
          {sync.chat.map((m, i) => (
            <div key={i}>
              <span style={{ color: colorOf(m.playerId) }}>{m.nickname}</span>
              <span style={{ color: "#888" }}>: </span>
              {m.text}
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
            placeholder="Message..."
            maxLength={500}
            style={{
              flex: 1,
              padding: 8,
              fontFamily: "inherit",
              background: "#000",
              color: "#eee",
              border: "1px solid #444",
            }}
          />
          <button onClick={send} style={miniBtn}>Send</button>
        </div>
      </section>

      <p style={{ marginTop: 32, color: "#666" }}>
        Reload this page -- state, chat history, and your identity all survive.
      </p>
    </main>
  );
}

const connColor = (c: string) =>
  c === "live" ? "#0a8" : c === "error" ? "#f66" : c === "polling" ? "#6af" : "#fa0";

const h2: React.CSSProperties = { fontSize: 14, textTransform: "uppercase", color: "#888" };

const debugStrip: React.CSSProperties = {
  display: "flex",
  gap: 16,
  alignItems: "center",
  flexWrap: "wrap",
  padding: "8px 12px",
  marginTop: 16,
  background: "#000",
  border: "1px solid #333",
  fontSize: 13,
};

const miniBtn: React.CSSProperties = {
  padding: "4px 10px",
  fontFamily: "inherit",
  fontSize: 13,
  cursor: "pointer",
  background: "#222",
  color: "#eee",
  border: "1px solid #555",
};

const chatBox: React.CSSProperties = {
  height: 160,
  overflowY: "auto",
  padding: 8,
  background: "#000",
  border: "1px solid #333",
  fontSize: 14,
};
