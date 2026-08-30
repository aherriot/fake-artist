import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api";
import { sql } from "drizzle-orm";
import { getPlayerId } from "@/lib/session";
import { mutate } from "@/lib/game/mutate";
import { broadcast } from "@/lib/pusher-server";

// Next.js requires these to be literal exports in the route file itself --
// re-exporting them from a shared module is silently ignored.
// preferredRegion pins the function to the Neon region so a distant player
// pays the cross-continent hop once, not twice. Change all at once with:
//   grep -rl 'preferredRegion' app | xargs sed -i '' 's/"iad1"/"fra1"/'
export const preferredRegion = "iad1";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/games/[code]/chat
 *
 * Chat rides the same event log as moves, so it inherits ordering, gap
 * detection, and replay-on-reload for free -- no separate table, no
 * separate sync path.
 */
async function postHandler(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const playerId = await getPlayerId();
  if (!playerId) return NextResponse.json({ error: "No session" }, { status: 401 });

  const { text } = (await req.json().catch(() => ({}))) as { text?: string };
  const msg = (text ?? "").trim().slice(0, 500);
  if (!msg) return NextResponse.json({ error: "Empty message" }, { status: 400 });

  const result = await mutate(code.toUpperCase(), async (ctx, tx) => {
    const p = await tx.execute<{ nickname: string }>(sql`
      SELECT nickname FROM players
       WHERE game_id = ${ctx.gameId}::uuid AND id = ${playerId}::uuid
    `);
    if (p.rows.length === 0)
      return { ok: false as const, error: "Not a player in this game", code: 403 };

    return {
      ok: true as const,
      produced: {
        event: {
          type: "chat" as const,
          payload: {
            playerId,
            nickname: p.rows[0].nickname,
            text: msg,
            at: new Date().toISOString(),
          },
        },
      },
    };
  });

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.code });

  await broadcast(code.toUpperCase(), result.event);
  return NextResponse.json({ ok: true, seq: result.event.seq });
}

export const POST = apiHandler(postHandler);
