"use client";

import { useState } from "react";
import type { useGameSync } from "@/lib/useGameSync";
import { Plaque, penTextVar } from "@/lib/ui/primitives";

export function Chat({ game }: { game: ReturnType<typeof useGameSync> }) {
  const { sync, sendChat, retryChat, discardChat } = game;
  const [text, setText] = useState("");
  const seatOf = (id: string) => sync.players.find((p) => p.id === id)?.seat ?? 0;

  function send() {
    const msg = text.trim();
    if (!msg) return;
    setText("");            // the message is already on screen
    void sendChat(msg);
  }

  return (
    <Plaque>
      <p className="label-caps mb-3">Chat</p>
      <div className="h-44 overflow-y-auto pr-1 text-sm">
        {sync.chat.length === 0 && sync.pending.chat.length === 0 && (
          <p className="text-label-700">Nothing said yet.</p>
        )}
        {sync.chat.map((m, i) => (
          <p key={i} className="mb-1">
            <span style={{ color: penTextVar(seatOf(m.playerId) + 1) }}>{m.nickname}</span>
            <span className="text-label-700">: </span>
            <span className="text-label-300">{m.text}</span>
          </p>
        ))}
        {/* Unconfirmed: visible at once, but clearly provisional. */}
        {sync.pending.chat.map((m) => (
          <p key={m.nonce} className={m.failed ? "mb-1" : "mb-1 opacity-50"}>
            <span style={{ color: penTextVar(seatOf(m.playerId) + 1) }}>{m.nickname}</span>
            <span className="text-label-700">: </span>
            <span className="text-label-300">{m.text}</span>
            {m.failed && (
              <span className="ml-2 text-xs text-danger">
                not sent
                <button onClick={() => retryChat(m.nonce)} className="ml-2 underline">retry</button>
                <button onClick={() => discardChat(m.nonce)} className="ml-2 underline">discard</button>
              </span>
            )}
          </p>
        ))}
      </div>
      <div className="mt-2 flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder="Say something…"
          maxLength={500}
          aria-label="Chat message"
          className="min-w-0 flex-1 rounded-sm border border-wall-500 bg-wall-900 px-2.5 py-1.5 text-sm text-label-100 placeholder:text-label-700 focus:border-accent-500 focus:outline-none"
        />
        <button
          onClick={send}
          className="rounded-sm border border-wall-500 bg-wall-700 px-3 text-sm hover:bg-wall-600"
        >
          Send
        </button>
      </div>
    </Plaque>
  );
}
