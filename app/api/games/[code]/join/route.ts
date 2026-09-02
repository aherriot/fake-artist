import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api";
import { sql } from "drizzle-orm";
import { getOrCreatePlayerId } from "@/lib/session";
import { mutate } from "@/lib/game/mutate";
import { broadcastAll } from "@/lib/pusher-server";
import { MAX_PLAYERS } from "@/lib/game/types";

// Next.js requires these to be literal exports in the route file itself --
// re-exporting them from a shared module is silently ignored.
// preferredRegion pins the function to the Neon region so a distant player
// pays the cross-continent hop once, not twice. Change all at once with:
//   grep -rl 'preferredRegion' app | xargs sed -i '' 's/"cle1"/"fra1"/'
export const preferredRegion = "cle1";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";



/** POST /api/games/[code]/join */
async function postHandler(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const { nickname } = (await req.json().catch(() => ({}))) as { nickname?: string };
  const name = (nickname ?? "").trim().slice(0, 24);
  if (!name) return NextResponse.json({ error: "Nickname required" }, { status: 400 });

  const playerId = await getOrCreatePlayerId();

  const result = await mutate(code.toUpperCase(), async (ctx, tx) => {
    // Rejoining an existing seat is a no-op, not an error -- this is the
    // path a reload takes, and it must stay idempotent.
    const existing = await tx.execute<{ seat: number }>(sql`
      SELECT seat FROM players
       WHERE game_id = ${ctx.gameId}::uuid AND id = ${playerId}::uuid
    `);
    if (existing.rows.length > 0) return { ok: false as const, error: "__already_joined__" };

    if (ctx.status !== "lobby")
      return { ok: false as const, error: "Game already started" };

    const seats = await tx.execute<{ next: number }>(sql`
      SELECT COALESCE(MAX(seat), -1) + 1 AS next
        FROM players WHERE game_id = ${ctx.gameId}::uuid
    `);
    const seat = Number(seats.rows[0].next);
    if (seat >= MAX_PLAYERS) return { ok: false as const, error: "Game is full" };

    await tx.execute(sql`
      INSERT INTO players (id, game_id, nickname, seat)
      VALUES (${playerId}::uuid, ${ctx.gameId}::uuid, ${name}, ${seat})
    `);

    return {
      ok: true as const,
      produced: {
        events: [{
          type: "player_joined" as const,
          payload: { id: playerId, nickname: name, seat },
        }],
      },
    };
  });

  if (!result.ok) {
    // Idempotent rejoin: report success so the client just refetches.
    if (result.error === "__already_joined__")
      return NextResponse.json({ ok: true, rejoined: true, playerId });
    return NextResponse.json({ error: result.error }, { status: result.code });
  }

  await broadcastAll(code.toUpperCase(), result.events);
  return NextResponse.json({ ok: true, playerId });
}

export const POST = apiHandler(postHandler);
