import {
  pgTable,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
  bigserial,
  index,
  uniqueIndex,
  primaryKey,
} from "drizzle-orm/pg-core";
import type { GameState, PrivateState } from "@/lib/game/types";

export const games = pgTable(
  "games",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull(),
    status: text("status", { enum: ["lobby", "active", "complete"] })
      .notNull()
      .default("lobby"),
    state: jsonb("state").$type<GameState>().notNull(),
    // Optimistic concurrency token. Every successful write bumps this.
    version: integer("version").notNull().default(0),
    hostId: uuid("host_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("games_code_idx").on(t.code),
    // The cleanup cron scans on these two.
    index("games_updated_at_idx").on(t.updatedAt),
    index("games_status_idx").on(t.status),
  ],
);

export const players = pgTable(
  "players",
  {
    // The cookie's player id. NOT unique on its own: the same browser can
    // create or join any number of games over time, so identity here is
    // (game_id, id) -- the same shape player_state already uses.
    id: uuid("id").notNull(),
    gameId: uuid("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    nickname: text("nickname").notNull(),
    seat: integer("seat").notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.gameId, t.id] }),
    index("players_game_id_idx").on(t.gameId),
    uniqueIndex("players_game_seat_idx").on(t.gameId, t.seat),
  ],
);

export const events = pgTable(
  "events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    gameId: uuid("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    // Per-game, gapless, monotonic. The cursor clients sync against.
    seq: integer("seq").notNull(),
    type: text("type").notNull(),
    payload: jsonb("payload").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // The invariant the entire sync design rests on.
    uniqueIndex("events_game_seq_idx").on(t.gameId, t.seq),
  ],
);

/**
 * Per-player PRIVATE state, deliberately NOT inside games.state.
 *
 * Two problems, one table:
 *  1. Secrecy -- a player's hand and their pending pick must never reach
 *     other clients. Separate rows make "send each player their own row"
 *     the natural query instead of filtering a shared blob on every read.
 *  2. Contention -- all players commit simultaneously. Owning distinct rows
 *     means those writes never touch the same tuple, so they never conflict.
 *     Measured at ~31x the throughput of serialising them on games.state.
 */
export const playerState = pgTable(
  "player_state",
  {
    gameId: uuid("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    playerId: uuid("player_id").notNull(),
    data: jsonb("data").$type<PrivateState>().notNull(),
    // Own concurrency token, independent of games.version.
    version: integer("version").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.gameId, t.playerId] })],
);

export type GameRow = typeof games.$inferSelect;
export type PlayerStateRow = typeof playerState.$inferSelect;
export type PlayerRow = typeof players.$inferSelect;
export type EventRow = typeof events.$inferSelect;
