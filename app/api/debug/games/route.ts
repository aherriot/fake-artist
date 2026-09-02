import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

// Next.js requires these to be literal exports in the route file itself --
// re-exporting them from a shared module is silently ignored.
// preferredRegion pins the function to the Neon region so a distant player
// pays the cross-continent hop once, not twice. Change all at once with:
//   grep -rl 'preferredRegion' app | xargs sed -i '' 's/"cle1"/"fra1"/'
export const preferredRegion = "cle1";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/debug/games -- powers the /debug page. POC-only, no auth. */
async function getHandler() {
  const rows = await db.execute(sql`
    SELECT g.code, g.status, g.version, g.created_at, g.updated_at,
           EXTRACT(EPOCH FROM (now() - g.updated_at))::int AS idle_seconds,
           (SELECT COUNT(*) FROM players p WHERE p.game_id = g.id)::int AS player_count,
           (SELECT COALESCE(MAX(seq), 0) FROM events e WHERE e.game_id = g.id)::int AS last_seq
      FROM games g ORDER BY g.updated_at DESC LIMIT 100
  `);
  return NextResponse.json({ games: rows.rows });
}

export const GET = apiHandler(getHandler);
