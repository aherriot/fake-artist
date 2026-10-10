import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { apiHandler, readJson } from "@/lib/api";
import { getPlayerId } from "@/lib/session";
import { mutate } from "@/lib/game/mutate";
import { afterDrop, clearBallots, openRound } from "@/lib/game/rounds";
import { broadcastAll } from "@/lib/pusher-server";
import { reduce, validateAction } from "@/lib/game/reduce";
import { MAX_PLAYERS, type DraftEvent, type GameAction, type GameState } from "@/lib/game/types";

// Next.js requires these to be literal exports in the route file itself --
// re-exporting them from a shared module is silently ignored.
export const preferredRegion = "cle1";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/games/[code]/action -- public actions on shared state.
 *
 * Secret acts (votes, the guess ballot) do NOT come through here; they go to
 * their own routes backed by mutatePlayer so they never touch the shared row
 * and never reach the event log.
 */
async function postHandler(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const playerId = await getPlayerId();
  if (!playerId) return NextResponse.json({ error: "No session" }, { status: 401 });

  const action = (await readJson<GameAction>(req)) as GameAction;
  if (!action?.type) return NextResponse.json({ error: "Invalid action" }, { status: 400 });

  const result = await mutate(code.toUpperCase(), async (ctx, tx) => {
    const rows = await tx.execute<{ id: string }>(sql`
      SELECT id FROM players WHERE game_id = ${ctx.gameId}::uuid ORDER BY seat ASC
    `);
    const ids = rows.rows.map((r) => r.id);

    const check = validateAction(action, {
      state: ctx.state,
      status: ctx.status,
      playerId,
      hostId: ctx.hostId,
      playerCount: ids.length,
    });
    if (!check.ok) return { ok: false as const, error: check.error };

    const events: DraftEvent[] = check.event ? [check.event] : [];

    if (action.type === "start_match") {
      // Seat order is the order people joined in, which is the order the
      // roster lists them, so everyone can see when their turn is coming.
      // Who starts is what varies -- see openRound.
      const seatOrder = ids;
      events.push({
        type: "match_started",
        payload: { at: new Date().toISOString(), seatOrder, totalRounds: ids.length },
      });
      events.push(
        await openRound(tx, ctx.gameId, { ...ctx.state, seatOrder }, 1),
      );
      return { ok: true as const, produced: { events, status: "active" as const } };
    }


    if (action.type === "drop_player") {
      const target = action.playerId;
      if (!ctx.state.seatOrder.includes(target))
        return { ok: false as const, error: "Not a player in this match" };
      if (ctx.state.absent.includes(target))
        return { ok: false as const, error: "Already dropped from this round" };

      events.push({ type: "player_dropped", payload: { playerId: target } });
      // Dropping someone can be the thing that completes the phase -- that is
      // the whole point, since otherwise the round waits on them forever.
      events.push(...(await afterDrop(tx, ctx.gameId, ctx.state, target)));
      return { ok: true as const, produced: { events } };
    }

    if (action.type === "approve_spectator") {
      const target = action.playerId;
      const spec = await tx.execute<{ approved: boolean }>(sql`
        SELECT approved FROM spectators
         WHERE game_id = ${ctx.gameId}::uuid AND id = ${target}::uuid
      `);
      if (spec.rows.length === 0)
        return { ok: false as const, error: "Not a spectator in this game" };
      if (spec.rows[0].approved)
        return { ok: false as const, error: "Already approved" };

      await tx.execute(sql`
        UPDATE spectators SET approved = true
         WHERE game_id = ${ctx.gameId}::uuid AND id = ${target}::uuid
      `);
      events.push({ type: "spectator_approved", payload: { id: target } });
      return { ok: true as const, produced: { events } };
    }

    if (action.type === "play_again") {
      // Same room, same code: nobody has to share a new link or re-join.
      events.push({ type: "match_reset", payload: { at: new Date().toISOString() } });
      return { ok: true as const, produced: { events, status: "lobby" as const } };
    }

    if (action.type === "end_match") {
      events.push({ type: "match_ended", payload: { at: new Date().toISOString() } });
      return { ok: true as const, produced: { events, status: "complete" as const } };
    }

    if (action.type === "next_round") {
      // Spectators the host approved get a real seat now, right before the
      // round they were promised starts -- never mid-round, so a drawing or
      // ballot already under way is never disturbed.
      let state: GameState = ctx.state;
      const approved = await tx.execute<{ id: string; nickname: string }>(sql`
        SELECT id, nickname FROM spectators
         WHERE game_id = ${ctx.gameId}::uuid AND approved = true
         ORDER BY created_at ASC
      `);
      if (approved.rows.length > 0) {
        const seats = await tx.execute<{ next: number }>(sql`
          SELECT COALESCE(MAX(seat), -1) + 1 AS next
            FROM players WHERE game_id = ${ctx.gameId}::uuid
        `);
        let seat = Number(seats.rows[0].next);
        for (const r of approved.rows) {
          if (seat >= MAX_PLAYERS) break; // Full -- stays a spectator.
          await tx.execute(sql`
            INSERT INTO players (id, game_id, nickname, seat)
            VALUES (${r.id}::uuid, ${ctx.gameId}::uuid, ${r.nickname}, ${seat})
          `);
          await tx.execute(sql`
            DELETE FROM spectators WHERE game_id = ${ctx.gameId}::uuid AND id = ${r.id}::uuid
          `);
          const event: DraftEvent = {
            type: "player_joined",
            payload: { id: r.id, nickname: r.nickname, seat },
          };
          events.push(event);
          state = reduce(state, { ...event, seq: 0 });
          seat++;
        }
      }

      const next = state.round + 1;
      if (next > state.totalRounds) {
        events.push({ type: "match_ended", payload: { at: new Date().toISOString() } });
        return { ok: true as const, produced: { events, status: "complete" as const } };
      }
      await clearBallots(tx, ctx.gameId);
      events.push(await openRound(tx, ctx.gameId, state, next));
    }

    return { ok: true as const, produced: { events } };
  });

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.code });
  await broadcastAll(code.toUpperCase(), result.events);
  return NextResponse.json({ ok: true });
}

export const POST = apiHandler(postHandler);
