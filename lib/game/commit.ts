import { sql } from "drizzle-orm";
import { dbTx } from "@/lib/db";
import { allocSeq, Conflict, MAX_ATTEMPTS, backoff, type Tx } from "./mutate";
import { isComplete, reduce, resolveRound, validateCommit } from "./reduce";
import { dealHand, type GameEvent, type GameState, type GameStatus, type PrivateState } from "./types";

export type CommitResult =
  | { ok: true; gameId: string; events: GameEvent[]; state: GameState }
  | { ok: false; error: string; code: number };

/**
 * The PRIVATE write path: a player commits a secret pick.
 *
 * The point of this function is what it does NOT touch. The pick is written
 * to that player's own row in `player_state`, so eight players committing
 * simultaneously write eight different tuples and never conflict -- measured
 * at ~31x the throughput of serialising them all on games.state.
 *
 * The pick itself never enters the event log. Only `player_committed` is
 * appended, which reveals that someone chose, not what they chose. That is
 * the invariant that keeps secrets out of every broadcast and every snapshot.
 *
 * When the commit completes the round, resolution happens in the SAME
 * transaction, so a crash can never leave a round half-resolved.
 */
export async function commitPick(
  code: string,
  playerId: string,
  tile: number,
  attempt = 0,
): Promise<CommitResult> {
  try {
    return await dbTx.transaction(async (tx) => {
      // Serialise commits WITHIN this game only.
      //
      // Without this, two players committing simultaneously can each read the
      // other's row as not-yet-committed, conclude they are not last, and
      // leave the round unresolved forever. The lock is per-game and released
      // at COMMIT; it costs a short wait, not a jsonb rewrite, which is the
      // expense the player_state split exists to avoid.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${code}, 0))`);

      const g = await tx.execute<{
        id: string;
        status: GameStatus;
        state: GameState;
        version: number;
      }>(sql`
        SELECT id, status, state, version FROM games WHERE code = ${code} LIMIT 1
      `);
      const game = g.rows[0];
      if (!game) return { ok: false as const, error: "Game not found", code: 404 };
      if (game.status !== "active")
        return { ok: false as const, error: "Game is not active", code: 400 };

      const ps = await tx.execute<{ data: PrivateState; version: number }>(sql`
        SELECT data, version FROM player_state
         WHERE game_id = ${game.id}::uuid AND player_id = ${playerId}::uuid
      `);
      const mine = ps.rows[0];
      if (!mine) return { ok: false as const, error: "Not a player in this game", code: 403 };

      const check = validateCommit(tile, mine.data, game.state);
      if (!check.ok) return { ok: false as const, error: check.error, code: 400 };

      // --- contention-free: this touches only THIS player's row ---
      const upd = await tx.execute<{ version: number }>(sql`
        UPDATE player_state
           SET data = ${JSON.stringify({ ...mine.data, pending: tile })}::jsonb,
               version = version + 1, updated_at = now()
         WHERE game_id = ${game.id}::uuid AND player_id = ${playerId}::uuid
           AND version = ${mine.version}
        RETURNING version
      `);
      if (upd.rows.length === 0) throw new Conflict();

      const events: GameEvent[] = [
        await allocSeq(tx, game.id, {
          type: "player_committed",
          payload: { playerId, round: game.state.round },
        }),
      ];
      let state = reduce(game.state, events[0]);

      // --- does this commit complete the round? ---
      const seated = await tx.execute<{ player_id: string; seat: number; data: PrivateState }>(sql`
        SELECT ps.player_id, p.seat, ps.data
          FROM player_state ps JOIN players p ON p.id = ps.player_id AND p.game_id = ps.game_id
         WHERE ps.game_id = ${game.id}::uuid ORDER BY p.seat ASC
      `);
      const everyone = seated.rows;
      const pending = everyone.filter((r) =>
        r.player_id === playerId ? true : r.data.pending !== null,
      );

      let nextStatus: GameStatus = game.status;
      let resolvedRound = false;

      if (pending.length === everyone.length) {
        resolvedRound = true;
        // All in. Resolve deterministically by seat, in this same transaction.
        const picks = everyone.map((r) => ({
          playerId: r.player_id,
          seat: r.seat,
          tile: r.player_id === playerId ? tile : (r.data.pending as number),
        }));
        const resolved = resolveRound(state, picks);

        const ev = await allocSeq(tx, game.id, {
          type: "round_resolved",
          payload: { round: state.round, picks: resolved, at: new Date().toISOString() },
        });
        events.push(ev);
        state = reduce(state, ev);

        // Clear pendings and drop each played tile from that player's hand.
        for (const r of everyone) {
          const played = r.player_id === playerId ? tile : (r.data.pending as number);
          const next: PrivateState = {
            hand: r.data.hand.filter((t) => t !== played),
            pending: null,
            round: state.round,
          };
          await tx.execute(sql`
            UPDATE player_state SET data = ${JSON.stringify(next)}::jsonb,
                   version = version + 1, updated_at = now()
             WHERE game_id = ${game.id}::uuid AND player_id = ${r.player_id}::uuid
          `);
        }

        if (isComplete(state)) {
          const endEv = await allocSeq(tx, game.id, {
            type: "game_ended",
            payload: { at: new Date().toISOString() },
          });
          events.push(endEv);
          state = reduce(state, endEv);
          nextStatus = "complete";
        }
      }

      // The shared row is written ONLY when a round actually resolves --
      // roughly once per N commits rather than once per commit. A plain
      // commit touches just the player's own small row plus the event log,
      // which is the entire point of splitting player_state out.
      if (resolvedRound) {
        const updated = await tx.execute<{ version: number }>(sql`
          UPDATE games SET state = ${JSON.stringify(state)}::jsonb, status = ${nextStatus},
                 version = version + 1, updated_at = now()
           WHERE id = ${game.id}::uuid AND version = ${game.version}
          RETURNING version
        `);
        if (updated.rows.length === 0) throw new Conflict();
      } else {
        // Keep the game from looking idle to the cleanup cron.
        await tx.execute(sql`
          UPDATE games SET updated_at = now() WHERE id = ${game.id}::uuid
        `);
      }

      return { ok: true as const, gameId: game.id, events, state };
    });
  } catch (err) {
    if (err instanceof Conflict) {
      if (attempt < MAX_ATTEMPTS) {
        await backoff(attempt);
        return commitPick(code, playerId, tile, attempt + 1);
      }
      return { ok: false, error: "Conflict, please retry", code: 409 };
    }
    throw err;
  }
}

/** Deal secret hands at game start. Runs inside the start transaction. */
export async function dealHands(tx: Tx, gameId: string, playerIds: string[]): Promise<void> {
  for (const id of playerIds) {
    const priv: PrivateState = { hand: dealHand(), pending: null, round: 1 };
    await tx.execute(sql`
      INSERT INTO player_state (game_id, player_id, data)
      VALUES (${gameId}::uuid, ${id}::uuid, ${JSON.stringify(priv)}::jsonb)
      ON CONFLICT (game_id, player_id) DO UPDATE SET data = EXCLUDED.data, version = 0
    `);
  }
}
