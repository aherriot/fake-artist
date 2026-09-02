"use client";

import { useState } from "react";
import { useGameSync } from "@/lib/useGameSync";
import { ErrorPanel } from "@/lib/ui/ErrorPanel";
import { MIN_PLAYERS } from "@/lib/game/types";

const COLORS = ["#e05", "#0a8", "#58f", "#fa0", "#a5f", "#5fa", "#f85", "#8f5", "#85f", "#5ff"];

/**
 * The live game. Mounted ONLY once membership is confirmed, because
 * useGameSync subscribes to the presence channel before fetching the
 * snapshot -- and a non-member cannot authorise that subscription.
 */
export default function GameView({ code }: { code: string }) {
  const { sync, forceResync } = useGameSync(code.toUpperCase());
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
        A Fake Artist Goes to New York
      </h1>
      <p style={{ color: "#888", marginTop: 4 }}>
        Room <strong style={{ letterSpacing: 4 }}>{code.toUpperCase()}</strong> — share this
        code. Status: <strong>{sync.status}</strong>
      </p>

      {/* The sync internals are the UI while this is still a harness. */}
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
                <span style={{ color: colorOf(p.id) }}>&#9632;</span> {p.nickname}
                {p.id === sync.hostId && <span style={{ color: "#888" }}> (host)</span>}
                {p.id === sync.you && <span style={{ color: "#888" }}> (you)</span>}
                <span style={{ color: sync.online.has(p.id) ? "#0a8" : "#666" }}>
                  {sync.online.has(p.id) ? " online" : " offline"}
                </span>
              </li>
            ))}
          </ul>

          {sync.status === "lobby" && isHost && (
            <button
              onClick={() => act({ type: "start_match" })}
              disabled={sync.players.length < MIN_PLAYERS}
              style={miniBtn}
            >
              Start match ({sync.players.length}/{MIN_PLAYERS} min)
            </button>
          )}
          {sync.status === "lobby" && !isHost && (
            <p style={{ color: "#888" }}>Waiting for host to start...</p>
          )}
          {actionError && <p style={{ color: "#f66" }}>{actionError}</p>}
        </div>

        {sync.status !== "lobby" && (
          <div style={{ flex: 1, minWidth: 260 }}>
            <h2 style={h2}>Game</h2>
            <div
              style={{
                border: "1px dashed #444",
                padding: 20,
                color: "#666",
                background: "#141414",
              }}
            >
              Rules not implemented yet.
              <br />
              <br />
              The lobby, realtime sync, reload-resume, private per-player state, and
              cleanup all work. The canvas, roles, and voting go here.
            </div>
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
  display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap",
  padding: "8px 12px", marginTop: 16, background: "#000",
  border: "1px solid #333", fontSize: 13,
};

const miniBtn: React.CSSProperties = {
  padding: "4px 10px", fontFamily: "inherit", fontSize: 13, cursor: "pointer",
  background: "#222", color: "#eee", border: "1px solid #555",
};

const chatBox: React.CSSProperties = {
  height: 160, overflowY: "auto", padding: 8, background: "#000",
  border: "1px solid #333", fontSize: 14,
};
