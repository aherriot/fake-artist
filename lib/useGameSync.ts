"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Channel, PresenceChannel } from "pusher-js";
import { getPusher, EVENT_NAME, channelFor } from "./pusher-client";
import { fetchJson } from "./fetch-json";
import {
  clearForNewRound,
  emptyPending,
  reconcile,
  type Pending,
  type PendingChat,
} from "./game/optimistic";
import { reduce } from "./game/reduce";
import {
  initialGameState,
  type GameEvent,
  type GameState,
  type GameStatus,
  type PlayerInfo,
  type PrivateState,
  normalizeGameState,
  type Snapshot,
} from "./game/types";

export type ConnState = "connecting" | "live" | "reconnecting" | "polling" | "error";

export interface SyncState {
  status: GameStatus;
  state: GameState;
  players: PlayerInfo[];
  chat: Extract<GameEvent, { type: "chat" }>["payload"][];
  lastSeq: number;
  hostId: string | null;
  /** This player's own secret hand and pending pick. Never anyone else's. */
  privateState: PrivateState | null;
  you: string | null;
  online: Set<string>;
  conn: ConnState;
  ready: boolean;
  error: string | null;
  /** Incremented whenever a gap forced a repair -- surfaced on the debug strip. */
  resyncs: number;
  /** The room code this hook is synced to. */
  code: string;
  /** Local predictions, not yet confirmed by the server. Kept separate from
   *  `state` so a gap-heal can never mistake one for a fact. */
  pending: Pending;
}

const EMPTY: SyncState = {
  status: "lobby",
  state: initialGameState(),
  players: [],
  chat: [],
  lastSeq: 0,
  hostId: null,
  privateState: null,
  you: null,
  online: new Set(),
  conn: "connecting",
  ready: false,
  error: null,
  resyncs: 0,
  code: "",
  pending: emptyPending(),
};

/**
 * Keeps a browser tab in sync with the authoritative game in Postgres.
 *
 * The ordering here is the whole trick:
 *
 *   1. Subscribe FIRST and buffer everything that arrives.
 *   2. Then fetch the snapshot (state + lastSeq).
 *   3. Drain the buffer, discarding anything at or below lastSeq.
 *
 * Subscribing before fetching closes the race where an event fires while the
 * snapshot request is in flight. Doing it the other way round silently drops
 * that event and the tab desyncs until the next gap is noticed.
 *
 * From then on every event is checked against lastSeq. Exactly-next applies;
 * a forward gap triggers a refetch; anything old is a duplicate and ignored.
 * That single rule covers dropped messages, out-of-order delivery, duplicate
 * delivery, reconnects, and browser reloads with no special-casing.
 */
export function useGameSync(code: string) {
  const [sync, setSync] = useState<SyncState>({ ...EMPTY, code });

  // Refs mirror state so the Pusher callbacks (bound once) always see current
  // values without re-subscribing on every event.
  const lastSeqRef = useRef(0);
  const readyRef = useRef(false);
  const bufferRef = useRef<GameEvent[]>([]);
  const healingRef = useRef(false);

  const applyEvent = useCallback((ev: GameEvent) => {
    setSync((prev) => {
      const next: SyncState = { ...prev, lastSeq: ev.seq };
      next.state = reduce(prev.state, ev);

      if (ev.type === "player_joined") {
        next.players = prev.players.some((p) => p.id === ev.payload.id)
          ? prev.players
          : [...prev.players, ev.payload].sort((a, b) => a.seat - b.seat);
      } else if (ev.type === "chat") {
        next.chat = [...prev.chat, ev.payload];
      } else if (ev.type === "match_started") {
        next.status = "active";
      } else if (ev.type === "match_ended") {
        next.status = "complete";
      }

      // A new round invalidates every per-round prediction.
      if (ev.type === "round_started") next.pending = clearForNewRound(prev.pending);
      // Retire anything the authoritative state has now caught up with.
      next.pending = reconcile(next.pending, next.state, next.you, [ev]);
      return next;
    });
    lastSeqRef.current = ev.seq;
  }, []);

  /**
   * Refetch this player's own private row.
   *
   * Private state deliberately never enters the event log, so it cannot be
   * derived by replaying events -- it has to be re-read whenever resolution
   * may have changed it (hand shrinks, pending clears).
   */
  const refetchPrivate = useCallback(async () => {
    const res = await fetchJson<Snapshot>(`/api/games/${code}/state`);
    if (!res.ok) return;
    setSync((p) => ({ ...p, privateState: res.data.privateState ?? null }));
  }, [code]);

  /** Refetch everything after `since` and apply it in order. */
  const heal = useCallback(
    async (since: number) => {
      if (healingRef.current) return;
      healingRef.current = true;
      try {
        const res = await fetchJson<{ events: GameEvent[] }>(
          `/api/games/${code}/events?since=${since}`,
        );
        if (!res.ok) return;
        const { events } = res.data;
        for (const ev of events) {
          if (ev.seq > lastSeqRef.current) applyEvent(ev);
        }
        if (events.length > 0) setSync((p) => ({ ...p, resyncs: p.resyncs + 1 }));
        return events.length;
      } finally {
        healingRef.current = false;
      }
    },
    [code, applyEvent],
  );

  /** The single funnel every incoming event passes through. */
  const ingest = useCallback(
    (ev: GameEvent) => {
      // Snapshot has not landed yet -- hold it; step 3 will sort it out.
      if (!readyRef.current) {
        bufferRef.current.push(ev);
        return;
      }
      if (ev.seq === lastSeqRef.current + 1) {
        applyEvent(ev);
        // Private state never travels in the log, so it cannot be derived by
        // replay -- re-read it whenever an event may have changed it. A new
        // round deals a new role and topic; a reveal clears the ballots.
        if (
          ev.type === "round_started" ||
          ev.type === "round_revealed" ||
          ev.type === "match_started"
        ) {
          void refetchPrivate();
        }
      } else if (ev.seq > lastSeqRef.current + 1) {
        // Gap: we missed something. Refetch rather than guess.
        void heal(lastSeqRef.current);
      }
      // ev.seq <= lastSeq -> duplicate or replay, ignore.
    },
    [applyEvent, heal, refetchPrivate],
  );

  const loadSnapshot = useCallback(async () => {
    const res = await fetchJson<Snapshot>(`/api/games/${code}/state`);
    if (!res.ok) {
      setSync((p) => ({ ...p, error: res.error, conn: "error" }));
      return;
    }
    const snap = res.data;
    lastSeqRef.current = snap.lastSeq;
    readyRef.current = true;

    setSync((p) => ({
      ...p,
      status: snap.status,
      state: normalizeGameState(snap.state),
      players: snap.players,
      lastSeq: snap.lastSeq,
      hostId: snap.hostId,
      you: snap.you,
      privateState: snap.privateState ?? null,
      pending: reconcile(p.pending, normalizeGameState(snap.state), snap.you, []),
      ready: true,
      error: null,
      // Chat replays from the log so history survives a reload.
      chat: [],
    }));

    // Rebuild chat history and catch up on anything after the snapshot.
    const res2 = await fetchJson<{ events: GameEvent[] }>(`/api/games/${code}/events?since=0`);
    if (res2.ok) {
      const chat = res2.data.events
        .filter((e): e is Extract<GameEvent, { type: "chat" }> => e.type === "chat")
        .map((e) => e.payload);
      setSync((p) => ({ ...p, chat }));
    }

    // Step 3: drain anything that arrived while we were fetching.
    const buffered = bufferRef.current.sort((a, b) => a.seq - b.seq);
    bufferRef.current = [];
    for (const ev of buffered) ingest(ev);
  }, [code, ingest]);

  useEffect(() => {
    const pusher = getPusher();

    // Step 1: bind BEFORE the snapshot fetch, so events that fire during it
    // are buffered rather than lost.
    let channel: PresenceChannel | null = null;
    let onConnState: ((s: { current: string }) => void) | null = null;

    if (pusher) {
      channel = pusher.subscribe(channelFor(code)) as PresenceChannel;
      channel.bind(EVENT_NAME, ingest);

      const syncPresence = () => {
        const ids = new Set<string>();
        channel?.members?.each((m: { id: string }) => ids.add(m.id));
        setSync((p) => ({ ...p, online: ids, conn: "live" }));
      };
      channel.bind("pusher:subscription_succeeded", syncPresence);
      channel.bind("pusher:member_added", syncPresence);
      channel.bind("pusher:member_removed", syncPresence);
      channel.bind("pusher:subscription_error", () =>
        // Auth failure is not fatal: polling still keeps the game playable.
        setSync((p) => ({ ...p, conn: "polling" })),
      );

      onConnState = ({ current }: { current: string }) => {
        if (current === "connected") {
          setSync((p) => ({ ...p, conn: "live" }));
          // Any reconnect may have dropped events. Always repair.
          if (readyRef.current) void heal(lastSeqRef.current);
        } else if (current === "connecting" || current === "unavailable") {
          setSync((p) => ({ ...p, conn: "reconnecting" }));
        } else if (current === "failed" || current === "disconnected") {
          setSync((p) => ({ ...p, conn: "polling" }));
        }
      };
      pusher.connection.bind("state_change", onConnState);
    } else {
      setSync((p) => ({ ...p, conn: "polling" }));
    }

    // Step 2.
    void loadSnapshot();

    /**
     * Polling backstop.
     *
     * Because the database is the source of truth and `heal` is idempotent,
     * polling is not a separate code path -- it is the same repair the gap
     * detector already runs. Fast when realtime is unavailable, slow as a
     * belt-and-braces sweep when it is working.
     */
    const poll = setInterval(() => {
      if (!readyRef.current) return;
      void heal(lastSeqRef.current);
    }, pusher ? 15_000 : 2_000);

    // A tab restored from background may have missed the reconnect entirely.
    const onVisible = () => {
      if (document.visibilityState === "visible" && readyRef.current) {
        void heal(lastSeqRef.current);
      }
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
      if (pusher && onConnState) pusher.connection.unbind("state_change", onConnState);
      if (channel) {
        channel.unbind_all();
        pusher?.unsubscribe(channelFor(code));
      }
      readyRef.current = false;
      lastSeqRef.current = 0;
      bufferRef.current = [];
    };
  }, [code, ingest, heal, loadSnapshot]);

  /* ------------------------------------------------------------ mutations */

  /**
   * Send a chat message, showing it immediately.
   *
   * The optimistic copy carries a nonce that the server echoes back, so it is
   * retired by the arrival of the real event rather than by the request
   * returning. That distinction matters: the POST can succeed while the
   * broadcast is still in flight, and clearing early would make the message
   * flicker out and back in.
   */
  const sendChat = useCallback(
    async (text: string) => {
      const msg = text.trim();
      if (!msg) return;
      const nonce = crypto.randomUUID();
      const optimistic: PendingChat = {
        nonce,
        playerId: sync.you ?? "",
        nickname: sync.players.find((p) => p.id === sync.you)?.nickname ?? "You",
        text: msg,
        at: new Date().toISOString(),
      };
      setSync((p) => ({ ...p, pending: { ...p.pending, chat: [...p.pending.chat, optimistic] } }));

      const res = await fetchJson(`/api/games/${code}/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: msg, nonce }),
      });
      if (!res.ok) {
        // Flag rather than drop: losing what someone typed is worse than
        // showing it greyed out with a retry.
        setSync((p) => ({
          ...p,
          pending: {
            ...p.pending,
            chat: p.pending.chat.map((c) => (c.nonce === nonce ? { ...c, failed: true } : c)),
          },
        }));
      }
    },
    [code, sync.you, sync.players],
  );

  const retryChat = useCallback(
    (nonce: string) => {
      const item = sync.pending.chat.find((c) => c.nonce === nonce);
      if (!item) return;
      setSync((p) => ({
        ...p,
        pending: { ...p.pending, chat: p.pending.chat.filter((c) => c.nonce !== nonce) },
      }));
      void sendChat(item.text);
    },
    [sync.pending.chat, sendChat],
  );

  const discardChat = useCallback((nonce: string) => {
    setSync((p) => ({
      ...p,
      pending: { ...p.pending, chat: p.pending.chat.filter((c) => c.nonce !== nonce) },
    }));
  }, []);

  /** Generic optimistic POST: predict, send, roll back on failure. */
  const optimisticPost = useCallback(
    async (
      path: string,
      body: unknown,
      predict: (p: Pending) => Pending,
      rollback: (p: Pending) => Pending,
    ): Promise<string | null> => {
      setSync((s0) => ({ ...s0, pending: predict(s0.pending) }));
      const res = await fetchJson<unknown>(`/api/games/${code}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setSync((s0) => ({ ...s0, pending: rollback(s0.pending) }));
        return res.error;
      }
      return null;
    },
    [code],
  );

  const submitStroke = useCallback(
    (points: [number, number][]) => {
      const seat = sync.players.find((p) => p.id === sync.you)?.seat ?? 0;
      const mine = { playerId: sync.you ?? "", seat, points };
      return optimisticPost(
        "/stroke",
        { points },
        (p) => ({ ...p, strokes: [...p.strokes, mine] }),
        (p) => ({ ...p, strokes: p.strokes.filter((s0) => s0 !== mine) }),
      );
    },
    [optimisticPost, sync.you, sync.players],
  );

  /** Cast or change a vote. Changing is allowed until the ballot closes. */
  const castVote = useCallback(
    async (targetId: string) => {
      const previous = sync.pending.votedFor;
      const err = await optimisticPost(
        "/vote",
        { targetId },
        (p) => ({ ...p, voted: true, votedFor: targetId }),
        (p) => ({ ...p, voted: previous !== null, votedFor: previous }),
      );
      return err;
    },
    [optimisticPost, sync.pending.votedFor],
  );

  /** Host only: stop the round waiting on a player who has gone. */
  const dropPlayer = useCallback(
    async (playerId: string) => {
      const res = await fetchJson(`/api/games/${code}/action`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "drop_player", playerId }),
      });
      return res.ok ? null : res.error;
    },
    [code],
  );

  const forceResync = useCallback(() => {
    lastSeqRef.current = 0;
    readyRef.current = false;
    bufferRef.current = [];
    // A manual resync means the user distrusts what they are seeing; keep only
    // failed chat, which is theirs and would otherwise be lost.
    setSync((p) => ({
      ...p,
      pending: { ...emptyPending(), chat: p.pending.chat.filter((c) => c.failed) },
    }));
    void loadSnapshot();
  }, [loadSnapshot]);

  return {
    sync,
    forceResync,
    refetchPrivate,
    sendChat,
    retryChat,
    discardChat,
    submitStroke,
    dropPlayer,
    castVote,
  } as const;
}
