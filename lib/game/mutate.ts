import { sql } from "drizzle-orm";
import { dbTx } from "@/lib/db";
import type { DraftEvent, GameEvent, GameState, GameStatus } from "./types";
import { reduce } from "./reduce";

/** The transaction handle drizzle hands to our callback. */
export type Tx = Parameters<Parameters<typeof dbTx.transaction>[0]>[0];

export interface MutationCtx {
  gameId: string;
  state: GameState;
  status: GameStatus;
  hostId: string;
  version: number;
}

export interface Produced {
  /** Public events, applied in order. Several are allowed because one action
   *  can drive more than one transition -- starting a match both begins the
   *  match and opens its first round. */
  events: DraftEvent[];
  status?: GameStatus;
}

export type Decision =
  | { ok: true; produced: Produced }
  | { ok: false; error: string; code?: number };

export type MutateResult =
  | { ok: true; gameId: string; events: GameEvent[]; state: GameState }
  | { ok: false; error: string; code: number };

export class Conflict extends Error {}

/** Retry budget. Measured: at 64-way contention 95.9% of writes need 1 retry,
 *  3.6% need 2, and 0.55% need 3-4. A cap of 2 turned that tail into spurious
 *  409s; 5 covers the observed maximum with headroom. */
const MAX_ATTEMPTS = 5;

/** Full jitter. Without it, writers that collided once collide again in
 *  lockstep on every subsequent retry. */
const backoff = (attempt: number) =>
  new Promise((r) => setTimeout(r, Math.random() * Math.min(20 * 2 ** attempt, 250)));

/**
 * Allocate the next per-game `seq` and append the event.
 *
 * `ON CONFLICT DO NOTHING` matters: two writers on DIFFERENT rows (two players
 * committing at once) can compute the same MAX(seq)+1. Raising a unique
 * violation would abort the whole transaction; returning zero rows lets us
 * simply retry the allocation inside the same transaction. The unique index
 * on (game_id, seq) is what makes this safe rather than merely lucky.
 */
export async function allocSeq(
  tx: Tx,
  gameId: string,
  draft: DraftEvent,
): Promise<GameEvent> {
  for (let i = 0; i < 10; i++) {
    const ins = await tx.execute<{ seq: number }>(sql`
      INSERT INTO events (game_id, seq, type, payload)
      SELECT ${gameId}::uuid, COALESCE(MAX(seq), 0) + 1,
             ${draft.type}, ${JSON.stringify(draft.payload)}::jsonb
        FROM events WHERE game_id = ${gameId}::uuid
      ON CONFLICT (game_id, seq) DO NOTHING
      RETURNING seq
    `);
    if (ins.rows.length > 0)
      return { ...draft, seq: Number(ins.rows[0].seq) } as GameEvent;
  }
  throw new Error("Could not allocate event seq after 10 attempts");
}

/**
 * The SHARED-state write path: anything touching games.state.
 *
 * Guarantees:
 *  1. `produce` validates against state read inside this transaction, so it
 *     can never decide from a stale view. It also receives `tx`, so related
 *     rows commit atomically -- and roll back together on conflict.
 *  2. The UPDATE is guarded by `version = $expected`; a writer that beat us
 *     matches 0 rows and we retry. No lost updates, no lock held across
 *     validation.
 *  3. `seq` is allocated only after that UPDATE succeeded.
 *
 * Prefer `mutatePlayer` for per-player writes -- it avoids this row entirely.
 */
export async function mutate(
  code: string,
  produce: (ctx: MutationCtx, tx: Tx) => Promise<Decision> | Decision,
  attempt = 0,
): Promise<MutateResult> {
  try {
    return await dbTx.transaction(async (tx) => {
      const found = await tx.execute<{
        id: string;
        status: GameStatus;
        state: GameState;
        version: number;
        host_id: string;
      }>(sql`
        SELECT id, status, state, version, host_id
          FROM games WHERE code = ${code} LIMIT 1
      `);
      const game = found.rows[0];
      if (!game) return { ok: false as const, error: "Game not found", code: 404 };

      const decision = await produce(
        {
          gameId: game.id,
          state: game.state,
          status: game.status,
          hostId: game.host_id,
          version: game.version,
        },
        tx,
      );
      if (!decision.ok)
        return { ok: false as const, error: decision.error, code: decision.code ?? 400 };

      const { events: drafts, status: nextStatus } = decision.produced;

      // seq is assigned by the database below; 0 is a placeholder that the
      // reducer never reads.
      let nextState = game.state;
      for (const d of drafts) nextState = reduce(nextState, { ...d, seq: 0 } as GameEvent);

      const updated = await tx.execute<{ version: number }>(sql`
        UPDATE games
           SET state = ${JSON.stringify(nextState)}::jsonb,
               status = ${nextStatus ?? game.status},
               version = version + 1,
               updated_at = now()
         WHERE id = ${game.id}::uuid AND version = ${game.version}
        RETURNING version
      `);
      if (updated.rows.length === 0) throw new Conflict();

      const events: GameEvent[] = [];
      for (const d of drafts) events.push(await allocSeq(tx, game.id, d));
      return { ok: true as const, gameId: game.id, events, state: nextState };
    });
  } catch (err) {
    if (err instanceof Conflict) {
      if (attempt < MAX_ATTEMPTS) {
        await backoff(attempt);
        return mutate(code, produce, attempt + 1);
      }
      return { ok: false, error: "Conflict, please retry", code: 409 };
    }
    throw err;
  }
}

export { MAX_ATTEMPTS, backoff };
