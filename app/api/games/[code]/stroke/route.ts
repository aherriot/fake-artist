import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { apiHandler, readJson } from "@/lib/api";
import { getPlayerId } from "@/lib/session";
import { mutate } from "@/lib/game/mutate";
import { broadcastAll } from "@/lib/pusher-server";
import { validateStroke } from "@/lib/game/reduce";

// Next.js requires these to be literal exports in the route file itself --
// re-exporting them from a shared module is silently ignored.
export const preferredRegion = "iad1";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/games/[code]/stroke -- commit one continuous line.
 *
 * The stroke is public: everyone watches the drawing build up, so it belongs
 * in the event log. What is validated here is whose turn it is -- the client
 * previews a line locally and only reaches this route on Submit.
 */
async function postHandler(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const playerId = await getPlayerId();
  if (!playerId) return NextResponse.json({ error: "No session" }, { status: 401 });

  const body = await readJson<{ points: [number, number][] }>(req);

  const result = await mutate(code.toUpperCase(), async (ctx, tx) => {
    const check = validateStroke(body.points, { state: ctx.state, playerId });
    if (!check.ok) return { ok: false as const, error: check.error };

    const seatRow = await tx.execute<{ seat: number }>(sql`
      SELECT seat FROM players
       WHERE game_id = ${ctx.gameId}::uuid AND id = ${playerId}::uuid
    `);
    const seat = seatRow.rows[0]?.seat ?? 0;

    return {
      ok: true as const,
      produced: {
        events: [
          { type: "stroke_drawn" as const, payload: { playerId, seat, points: check.points } },
        ],
      },
    };
  });

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.code });
  await broadcastAll(code.toUpperCase(), result.events);
  return NextResponse.json({ ok: true });
}

export const POST = apiHandler(postHandler);
