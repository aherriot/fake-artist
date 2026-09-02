import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { apiHandler, readJson } from "@/lib/api";
import { getPlayerId } from "@/lib/session";
import { mutate } from "@/lib/game/mutate";
import { clearBallots, openRound, shuffle } from "@/lib/game/rounds";
import { broadcastAll } from "@/lib/pusher-server";
import { validateAction } from "@/lib/game/reduce";
import type { DraftEvent, GameAction } from "@/lib/game/types";

// Next.js requires these to be literal exports in the route file itself --
// re-exporting them from a shared module is silently ignored.
export const preferredRegion = "iad1";
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
      // Seat order is shuffled once and then fixed for the whole match.
      const seatOrder = shuffle(ids);
      events.push({
        type: "match_started",
        payload: { at: new Date().toISOString(), seatOrder, totalRounds: ids.length },
      });
      events.push(
        await openRound(tx, ctx.gameId, { ...ctx.state, seatOrder }, 1),
      );
      return { ok: true as const, produced: { events, status: "active" as const } };
    }

    if (action.type === "open_voting") {
      events.push({ type: "voting_started", payload: { candidates: [] } });
    }

    if (action.type === "next_round") {
      const next = ctx.state.round + 1;
      if (next > ctx.state.totalRounds) {
        events.push({ type: "match_ended", payload: { at: new Date().toISOString() } });
        return { ok: true as const, produced: { events, status: "complete" as const } };
      }
      await clearBallots(tx, ctx.gameId);
      events.push(await openRound(tx, ctx.gameId, ctx.state, next));
    }

    return { ok: true as const, produced: { events } };
  });

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.code });
  await broadcastAll(code.toUpperCase(), result.events);
  return NextResponse.json({ ok: true });
}

export const POST = apiHandler(postHandler);
