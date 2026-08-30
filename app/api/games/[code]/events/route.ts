import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import type { GameEvent } from "@/lib/game/types";

// Next.js requires these to be literal exports in the route file itself --
// re-exporting them from a shared module is silently ignored.
// preferredRegion pins the function to the Neon region so a distant player
// pays the cross-continent hop once, not twice. Change all at once with:
//   grep -rl 'preferredRegion' app | xargs sed -i '' 's/"iad1"/"fra1"/'
export const preferredRegion = "iad1";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/games/[code]/events?since=N -- the self-healing path.
 *
 * Called whenever a client detects a seq gap or reconnects. This is what
 * makes a dropped Pusher message a latency blip instead of a desync.
 */
async function getHandler(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const since = Number(new URL(req.url).searchParams.get("since") ?? 0);
  if (!Number.isFinite(since) || since < 0)
    return NextResponse.json({ error: "Invalid `since`" }, { status: 400 });

  const rows = await db.execute<{ seq: number; type: string; payload: unknown }>(sql`
    SELECT e.seq, e.type, e.payload
      FROM events e JOIN games g ON g.id = e.game_id
     WHERE g.code = ${code.toUpperCase()} AND e.seq > ${since}
     ORDER BY e.seq ASC LIMIT 500
  `);

  const events = rows.rows.map(
    (r) => ({ seq: Number(r.seq), type: r.type, payload: r.payload }) as GameEvent,
  );
  return NextResponse.json({ events });
}

export const GET = apiHandler(getHandler);
