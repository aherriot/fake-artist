import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api";
import { getPlayerId } from "@/lib/session";
import { commitPick } from "@/lib/game/commit";
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
 * POST /api/games/[code]/commit -- submit this round's SECRET pick.
 *
 * The response deliberately echoes nothing about the pick beyond "accepted",
 * and the broadcast carries only `player_committed`. The tile stays in the
 * player's own row until resolution reveals every pick at once.
 */
async function postHandler(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const playerId = await getPlayerId();
  if (!playerId) return NextResponse.json({ error: "No session" }, { status: 401 });

  const { tile } = (await req.json().catch(() => ({}))) as { tile?: number };
  if (typeof tile !== "number" || !Number.isInteger(tile))
    return NextResponse.json({ error: "Invalid tile" }, { status: 400 });

  const result = await commitPick(code.toUpperCase(), playerId, tile);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.code });

  // Usually one event; two or three on the commit that completes the round.
  for (const ev of result.events) await broadcast(code.toUpperCase(), ev);
  return NextResponse.json({ ok: true });
}

export const POST = apiHandler(postHandler);
