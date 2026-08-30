import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api";
import { sql } from "drizzle-orm";
import { getPlayerId } from "@/lib/session";
import { mutate } from "@/lib/game/mutate";
import { dealHands } from "@/lib/game/commit";
import { broadcast } from "@/lib/pusher-server";
import { validateAction } from "@/lib/game/reduce";
import type { GameAction } from "@/lib/game/types";

// Next.js requires these to be literal exports in the route file itself --
// re-exporting them from a shared module is silently ignored.
// preferredRegion pins the function to the Neon region so a distant player
// pays the cross-continent hop once, not twice. Change all at once with:
//   grep -rl 'preferredRegion' app | xargs sed -i '' 's/"iad1"/"fra1"/'
export const preferredRegion = "iad1";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/games/[code]/action -- public actions on shared state.
 *
 * Per-player secret picks do NOT come through here; they go to /commit so
 * they never touch the shared row. This endpoint is for state everyone sees.
 */
async function postHandler(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const playerId = await getPlayerId();
  if (!playerId) return NextResponse.json({ error: "No session" }, { status: 401 });

  const action = (await req.json().catch(() => null)) as GameAction | null;
  if (!action?.type) return NextResponse.json({ error: "Invalid action" }, { status: 400 });

  const result = await mutate(code.toUpperCase(), async (ctx, tx) => {
    const check = validateAction(action, {
      state: ctx.state,
      status: ctx.status,
      playerId,
      hostId: ctx.hostId,
    });
    if (!check.ok) return { ok: false as const, error: check.error };

    if (check.event.type === "game_started") {
      // Secret hands are dealt in the same transaction that starts the game,
      // so a player can never observe an active game without a hand.
      const ids = await tx.execute<{ id: string }>(sql`
        SELECT id FROM players WHERE game_id = ${ctx.gameId}::uuid ORDER BY seat ASC
      `);
      await dealHands(tx, ctx.gameId, ids.rows.map((r) => r.id));
      return { ok: true as const, produced: { event: check.event, status: "active" as const } };
    }
    return { ok: true as const, produced: { event: check.event } };
  });

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.code });

  await broadcast(code.toUpperCase(), result.event);
  return NextResponse.json({ ok: true, seq: result.event.seq });
}

export const POST = apiHandler(postHandler);
