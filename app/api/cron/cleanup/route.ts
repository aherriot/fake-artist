import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

// Next.js requires these to be literal exports in the route file itself --
// re-exporting them from a shared module is silently ignored.
// preferredRegion pins the function to the Neon region so a distant player
// pays the cross-continent hop once, not twice. Change all at once with:
//   grep -rl 'preferredRegion' app | xargs sed -i '' 's/"iad1"/"fra1"/'
export const preferredRegion = "iad1";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/cron/cleanup -- invoked daily by Vercel Cron (see vercel.json).
 *
 * Because games last at most ~1 hour, "stale" is unambiguous and we can be
 * blunt about deletion. `players` and `events` cascade from `games`.
 *
 * Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. Without this guard
 * the endpoint is a public database-wipe button.
 */
async function getHandler(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET not set" }, { status: 500 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const result = await db.execute<{ id: string; status: string }>(sql`
    DELETE FROM games
     WHERE (status = 'complete' AND updated_at < now() - interval '24 hours')
        OR (status = 'lobby'    AND created_at < now() - interval '2 hours')
        OR (updated_at < now() - interval '6 hours')
    RETURNING id, status
  `);

  const deleted = result.rows.length;
  console.log(`[cleanup] deleted ${deleted} game(s)`);
  return NextResponse.json({ deleted, games: result.rows });
}

export const GET = apiHandler(getHandler);
