"use client";

import { useEffect, useState } from "react";

interface Row {
  code: string;
  status: string;
  version: number;
  player_count: number;
  last_seq: number;
  idle_seconds: number;
  created_at: string;
}

export default function Debug() {
  const [rows, setRows] = useState<Row[]>([]);

  useEffect(() => {
    const load = () =>
      fetch("/api/debug/games")
        .then((r) => r.json())
        .then((d) => setRows(d.games ?? []))
        .catch(() => {});
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, []);

  return (
    <main>
      <h1>Debug</h1>
      <p style={{ color: "#888" }}>
        Refreshes every 3s. Cleanup deletes: complete &gt;24h, lobby &gt;2h, any idle &gt;6h.
      </p>
      <a href="/" style={{ color: "#6af" }}>Home</a>
      <table style={{ marginTop: 16, borderCollapse: "collapse", fontSize: 14 }}>
        <thead>
          <tr>
            {["code", "status", "players", "lastSeq", "version", "idle"].map((h) => (
              <th key={h} style={cell}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.code}>
              <td style={cell}><a href={`/game/${r.code}`} style={{ color: "#6af" }}>{r.code}</a></td>
              <td style={cell}>{r.status}</td>
              <td style={cell}>{r.player_count}</td>
              <td style={cell}>{r.last_seq}</td>
              <td style={cell}>{r.version}</td>
              <td style={cell}>{fmt(r.idle_seconds)}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td style={cell} colSpan={6}>No games.</td></tr>
          )}
        </tbody>
      </table>
    </main>
  );
}

const fmt = (s: number) =>
  s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h`;

const cell: React.CSSProperties = {
  border: "1px solid #333",
  padding: "4px 10px",
  textAlign: "left",
};
