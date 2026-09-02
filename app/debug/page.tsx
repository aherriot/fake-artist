"use client";

import { useEffect, useState } from "react";
import { Wordmark } from "@/lib/ui/Wordmark";
import { Plaque, Pill } from "@/lib/ui/primitives";
import { fetchJson } from "@/lib/fetch-json";

interface Row {
  code: string;
  status: string;
  version: number;
  player_count: number;
  last_seq: number;
  idle_seconds: number;
}

export default function Debug() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      const r = await fetchJson<{ games: Row[] }>("/api/debug/games");
      if (r.ok) { setRows(r.data.games ?? []); setError(null); }
      else setError(r.error);
    };
    void load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, []);

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <Wordmark />
      <h1 className="mt-8 font-display text-3xl">Rooms</h1>
      <p className="mt-2 text-sm text-label-500">
        Refreshes every 3s. Cleanup removes: complete &gt;24h, lobby &gt;2h, any idle &gt;6h.
      </p>

      {error && <p role="alert" className="mt-4 text-sm text-danger">{error}</p>}

      {rows === null && !error && (
        <div className="mt-6 animate-pulse space-y-2" aria-label="Loading rooms">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-10 rounded-sm border border-wall-500 bg-wall-700" />
          ))}
        </div>
      )}

      {rows?.length === 0 && (
        <Plaque className="mt-6 text-center text-label-500">No rooms right now.</Plaque>
      )}

      {rows && rows.length > 0 && (
        <div className="mt-6 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-wall-500">
                {["room", "status", "players", "seq", "version", "idle"].map((h) => (
                  <th key={h} className="label-caps py-2 pr-4 text-left">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.code} className="border-b border-wall-600">
                  <td className="py-2 pr-4">
                    <a href={`/game/${r.code}`} className="catalogue-no underline hover:text-label-100">
                      {r.code}
                    </a>
                  </td>
                  <td className="py-2 pr-4">
                    <Pill tone={r.status === "active" ? "accent" : r.status === "complete" ? "success" : "neutral"}>
                      {r.status}
                    </Pill>
                  </td>
                  <td className="py-2 pr-4 text-label-300">{r.player_count}</td>
                  <td className="py-2 pr-4 text-label-300">{r.last_seq}</td>
                  <td className="py-2 pr-4 text-label-300">{r.version}</td>
                  <td className="py-2 pr-4 text-label-500">{fmt(r.idle_seconds)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}

const fmt = (s: number) =>
  s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h`;
