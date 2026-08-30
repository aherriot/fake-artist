"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { fetchJson } from "@/lib/fetch-json";

export default function Home() {
  const router = useRouter();
  const [nickname, setNickname] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function post<T>(url: string, body: unknown): Promise<T | null> {
    setBusy(true);
    setError(null);
    const res = await fetchJson<T>(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (!res.ok) {
      // requestId ties this message to the matching server log line.
      setError(res.requestId ? `${res.error} (ref ${res.requestId})` : res.error);
      return null;
    }
    return res.data;
  }

  async function create() {
    const data = await post<{ code: string }>("/api/games", { nickname });
    if (data?.code) router.push(`/game/${data.code}`);
  }

  async function join() {
    const c = code.trim().toUpperCase();
    const data = await post<{ ok: boolean }>(`/api/games/${c}/join`, { nickname });
    if (data) router.push(`/game/${c}`);
  }

  const canSubmit = nickname.trim().length > 0 && !busy;

  return (
    <main style={{ maxWidth: 480 }}>
      <h1>Multiplayer POC</h1>
      <p style={{ color: "#888" }}>
        Proving lobby, realtime sync, reload-resume, and cleanup. Not RoboRally yet.
      </p>

      <label style={{ display: "block", marginTop: 24 }}>
        Nickname
        <input
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          maxLength={24}
          style={inputStyle}
          placeholder="e.g. Zipper"
        />
      </label>

      <button onClick={create} disabled={!canSubmit} style={btnStyle}>
        Create game
      </button>

      <hr style={{ margin: "24px 0", borderColor: "#333" }} />

      <label style={{ display: "block" }}>
        Join code
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          maxLength={6}
          style={{ ...inputStyle, letterSpacing: 4 }}
          placeholder="ABC123"
        />
      </label>
      <button
        onClick={join}
        disabled={!canSubmit || code.trim().length !== 6}
        style={btnStyle}
      >
        Join game
      </button>

      {error && (
        <p style={{ color: "#f66", whiteSpace: "pre-wrap" }} role="alert">
          {error}
        </p>
      )}

      <p style={{ marginTop: 32 }}>
        <a href="/debug" style={{ color: "#6af" }}>
          /debug -- inspect games and watch cleanup
        </a>
      </p>
    </main>
  );
}

const inputStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  padding: 8,
  marginTop: 4,
  fontSize: 16,
  fontFamily: "inherit",
  background: "#000",
  color: "#eee",
  border: "1px solid #444",
};

const btnStyle: React.CSSProperties = {
  marginTop: 12,
  padding: "8px 16px",
  fontSize: 16,
  fontFamily: "inherit",
  cursor: "pointer",
  background: "#222",
  color: "#eee",
  border: "1px solid #555",
};
