"use client";

import { use, useCallback, useEffect, useState } from "react";
import GameView from "./GameView";
import { fetchJson } from "@/lib/fetch-json";
import type { Snapshot } from "@/lib/game/types";

type Gate =
  | { kind: "checking" }
  | { kind: "member" }
  | { kind: "stranger"; status: Snapshot["status"]; players: number }
  | { kind: "error"; message: string };

/**
 * Membership gate for /game/[code].
 *
 * Someone following a shared link has no cookie and has not joined, so they
 * cannot authorise the presence-channel subscription that useGameSync opens
 * before its first fetch. Resolving membership FIRST means we either prompt
 * for a nickname or mount the live view -- never mount it and 401.
 *
 * The extra round trip costs members one cheap request and buys the
 * subscribe-before-snapshot ordering that keeps their sync race-free.
 */
export default function GamePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const upper = code.toUpperCase();

  const [gate, setGate] = useState<Gate>({ kind: "checking" });
  const [nickname, setNickname] = useState("");
  const [busy, setBusy] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  const check = useCallback(async () => {
    const res = await fetchJson<Snapshot>(`/api/games/${upper}/state`);
    if (!res.ok) {
      setGate({ kind: "error", message: res.error });
      return;
    }
    setGate(
      res.data.isPlayer
        ? { kind: "member" }
        : { kind: "stranger", status: res.data.status, players: res.data.players.length },
    );
  }, [upper]);

  useEffect(() => {
    void check();
  }, [check]);

  async function join() {
    setBusy(true);
    setJoinError(null);
    const res = await fetchJson<{ ok: boolean }>(`/api/games/${upper}/join`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nickname }),
    });
    setBusy(false);
    if (!res.ok) {
      setJoinError(res.requestId ? `${res.error} (ref ${res.requestId})` : res.error);
      return;
    }
    setGate({ kind: "member" });
  }

  if (gate.kind === "checking") return <main>Loading {upper}...</main>;

  if (gate.kind === "error") {
    return (
      <main>
        <h1>{gate.message}</h1>
        <a href="/" style={{ color: "#6af" }}>
          Back
        </a>
      </main>
    );
  }

  if (gate.kind === "stranger") {
    // A game already under way cannot take new players; say so plainly
    // rather than letting the join attempt fail after they type a name.
    const closed = gate.status !== "lobby";
    return (
      <main style={{ maxWidth: 420 }}>
        <h1>
          Join <span style={{ letterSpacing: 4 }}>{upper}</span>
        </h1>
        {closed ? (
          <>
            <p style={{ color: "#f66" }}>
              This game is already {gate.status} and is not accepting new players.
            </p>
            <a href="/" style={{ color: "#6af" }}>
              Start your own game
            </a>
          </>
        ) : (
          <>
            <p style={{ color: "#888" }}>
              {gate.players} player{gate.players === 1 ? "" : "s"} waiting. Pick a
              nickname to join.
            </p>
            <label style={{ display: "block", marginTop: 16 }}>
              Nickname
              <input
                autoFocus
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && nickname.trim() && !busy && join()}
                maxLength={24}
                placeholder="e.g. Hammer"
                style={{
                  display: "block",
                  width: "100%",
                  padding: 8,
                  marginTop: 4,
                  fontSize: 16,
                  fontFamily: "inherit",
                  background: "#000",
                  color: "#eee",
                  border: "1px solid #444",
                }}
              />
            </label>
            <button
              onClick={join}
              disabled={!nickname.trim() || busy}
              style={{
                marginTop: 12,
                padding: "8px 16px",
                fontSize: 16,
                fontFamily: "inherit",
                cursor: "pointer",
                background: "#222",
                color: "#eee",
                border: "1px solid #555",
              }}
            >
              {busy ? "Joining..." : "Join game"}
            </button>
            {joinError && (
              <p style={{ color: "#f66" }} role="alert">
                {joinError}
              </p>
            )}
          </>
        )}
      </main>
    );
  }

  return <GameView code={upper} />;
}
