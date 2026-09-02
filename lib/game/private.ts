import { sql } from "drizzle-orm";
import { dbTx } from "@/lib/db";
import { allocSeq, Conflict, MAX_ATTEMPTS, backoff, type Tx } from "./mutate";
import type { DraftEvent, GameEvent, GameState, GameStatus, PrivateState } from "./types";

export interface PrivateCtx {
  gameId: string;
  state: GameState;
  status: GameStatus;
  version: number;
  /** This player's current private row. */
  priv: PrivateState;
}

export type PrivateDecision =
  | {
      ok: true;
      /** The player's new private row. Never broadcast. */
      data: PrivateState;
      /** Optional PUBLIC event. Must not contain anything secret. */
      event?: DraftEvent;
    }
  | { ok: false; error: string; code?: number };

export type PrivateResult =
  | { ok: true; gameId: string; events: GameEvent[]; priv: PrivateState }
  | { ok: false; error: string; code: number };

/**
 * The PRIVATE write path: a player mutates only their own row.
 *
 * The point is what it does NOT touch. Writing to `player_state` means many
 * players acting at once write different tuples and never conflict, and the
 * shared `games.state` row is left alone -- which is what decouples write cost
 * from the size of the public state.
 *
 * Secrets stay out of the log by construction: `data` goes to the player's own
 * row, and only the optional `event` is appended and broadcast.
 *
 * The advisory lock serialises writes WITHIN one game. It is what makes it
 * safe for `produce` to read other players' rows and decide something about
 * the group -- whose turn it is, whether everyone has acted -- without two
 * concurrent writers each seeing a stale view and both deciding "not me".
 */
export async function mutatePlayer(
  code: string,
  playerId: string,
  produce: (ctx: PrivateCtx, tx: Tx) => Promise<PrivateDecision> | PrivateDecision,
  attempt = 0,
): Promise<PrivateResult> {
  try {
    return await dbTx.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${code}, 0))`);

      const g = await tx.execute<{
        id: string;
        status: GameStatus;
        state: GameState;
        version: number;
      }>(sql`SELECT id, status, state, version FROM games WHERE code = ${code} LIMIT 1`);
      const game = g.rows[0];
      if (!game) return { ok: false as const, error: "Game not found", code: 404 };

      const ps = await tx.execute<{ data: PrivateState; version: number }>(sql`
        SELECT data, version FROM player_state
         WHERE game_id = ${game.id}::uuid AND player_id = ${playerId}::uuid
      `);
      const mine = ps.rows[0];
      if (!mine)
        return { ok: false as const, error: "Not a player in this game", code: 403 };

      const decision = await produce(
        {
          gameId: game.id,
          state: game.state,
          status: game.status,
          version: game.version,
          priv: mine.data,
        },
        tx,
      );
      if (!decision.ok)
        return { ok: false as const, error: decision.error, code: decision.code ?? 400 };

      const upd = await tx.execute<{ version: number }>(sql`
        UPDATE player_state
           SET data = ${JSON.stringify(decision.data)}::jsonb,
               version = version + 1, updated_at = now()
         WHERE game_id = ${game.id}::uuid AND player_id = ${playerId}::uuid
           AND version = ${mine.version}
        RETURNING version
      `);
      if (upd.rows.length === 0) throw new Conflict();

      const events: GameEvent[] = [];
      if (decision.event) events.push(await allocSeq(tx, game.id, decision.event));

      // Keep the game from looking idle to the cleanup cron.
      await tx.execute(sql`UPDATE games SET updated_at = now() WHERE id = ${game.id}::uuid`);

      return { ok: true as const, gameId: game.id, events, priv: decision.data };
    });
  } catch (err) {
    if (err instanceof Conflict) {
      if (attempt < MAX_ATTEMPTS) {
        await backoff(attempt);
        return mutatePlayer(code, playerId, produce, attempt + 1);
      }
      return { ok: false, error: "Conflict, please retry", code: 409 };
    }
    throw err;
  }
}

/**
 * Seed every player's private row, inside the transaction that starts the
 * game -- so no player can ever observe an active game without their secret.
 */
export async function initPrivateState(
  tx: Tx,
  gameId: string,
  entries: { playerId: string; data: PrivateState }[],
): Promise<void> {
  for (const { playerId, data } of entries) {
    await tx.execute(sql`
      INSERT INTO player_state (game_id, player_id, data)
      VALUES (${gameId}::uuid, ${playerId}::uuid, ${JSON.stringify(data)}::jsonb)
      ON CONFLICT (game_id, player_id) DO UPDATE SET data = EXCLUDED.data, version = 0
    `);
  }
}
