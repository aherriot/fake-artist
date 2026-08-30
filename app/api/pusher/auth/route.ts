import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { getPlayerId } from "@/lib/session";
import { pusher } from "@/lib/pusher-server";

// Next.js requires these to be literal exports in the route file itself --
// re-exporting them from a shared module is silently ignored.
// preferredRegion pins the function to the Neon region so a distant player
// pays the cross-continent hop once, not twice. Change all at once with:
//   grep -rl 'preferredRegion' app | xargs sed -i '' 's/"iad1"/"fra1"/'
export const preferredRegion = "iad1";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/pusher/auth -- presence channel authorisation.
 *
 * This is the security boundary for realtime. We confirm from the DB that
 * the cookie's player actually belongs to the game named in the channel
 * before granting a subscription; otherwise any client could subscribe to
 * any game's channel and watch it play out.
 */
async function postHandler(req: Request) {
  const playerId = await getPlayerId();
  if (!playerId) return NextResponse.json({ error: "No session" }, { status: 401 });

  const form = await req.formData();
  const socketId = String(form.get("socket_id") ?? "");
  const channel = String(form.get("channel_name") ?? "");

  const match = /^presence-game-([A-Z0-9]{6})$/.exec(channel);
  if (!socketId || !match)
    return NextResponse.json({ error: "Bad request" }, { status: 400 });

  const rows = await db.execute<{ nickname: string; seat: number }>(sql`
    SELECT p.nickname, p.seat
      FROM players p JOIN games g ON g.id = p.game_id
     WHERE g.code = ${match[1]} AND p.id = ${playerId}::uuid
  `);
  if (rows.rows.length === 0)
    return NextResponse.json({ error: "Not a member of this game" }, { status: 403 });

  const auth = pusher.authorizeChannel(socketId, channel, {
    user_id: playerId,
    user_info: { nickname: rows.rows[0].nickname, seat: rows.rows[0].seat },
  });
  return NextResponse.json(auth);
}

export const POST = apiHandler(postHandler);
