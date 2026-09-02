import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { getOrCreatePlayerId } from "@/lib/session";
import type {
  GameState,
  GameStatus,
  PlayerInfo,
  PrivateState,
  Snapshot,
} from "@/lib/game/types";
import { normalizeGameState } from "@/lib/game/types";

// Next.js requires these to be literal exports in the route file itself --
// re-exporting them from a shared module is silently ignored.
// preferredRegion pins the function to the Neon region so a distant player
// pays the cross-continent hop once, not twice. Change all at once with:
//   grep -rl 'preferredRegion' app | xargs sed -i '' 's/"iad1"/"fra1"/'
export const preferredRegion = "iad1";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/games/[code]/state -- the snapshot a client boots from.
 *
 * Returns public state plus the `lastSeq` it is consistent with, and ONLY the
 * requesting player's own private row. Other players' hands and pending picks
 * are never read here, so they cannot leak through this endpoint.
 */
async function getHandler(_req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const playerId = await getOrCreatePlayerId();

  const rows = await db.execute<{
    id: string;
    code: string;
    status: GameStatus;
    state: GameState;
    host_id: string;
    last_seq: number | null;
  }>(sql`
    SELECT g.id, g.code, g.status, g.state, g.host_id,
           (SELECT MAX(seq) FROM events e WHERE e.game_id = g.id) AS last_seq
      FROM games g WHERE g.code = ${code.toUpperCase()} LIMIT 1
  `);

  const game = rows.rows[0];
  if (!game) return NextResponse.json({ error: "Game not found" }, { status: 404 });

  const [p, priv] = await Promise.all([
    db.execute<{ id: string; nickname: string; seat: number }>(sql`
      SELECT id, nickname, seat FROM players
       WHERE game_id = ${game.id}::uuid ORDER BY seat ASC
    `),
    // Scoped to this player by primary key -- secrecy enforced by the query.
    db.execute<{ data: PrivateState }>(sql`
      SELECT data FROM player_state
       WHERE game_id = ${game.id}::uuid AND player_id = ${playerId}::uuid
    `),
  ]);

  const snapshot: Snapshot = {
    gameId: game.id,
    code: game.code,
    status: game.status,
    state: normalizeGameState(game.state),
    lastSeq: Number(game.last_seq ?? 0),
    players: p.rows as PlayerInfo[],
    hostId: game.host_id,
    you: playerId,
    isPlayer: p.rows.some((r) => r.id === playerId),
    privateState: priv.rows[0]?.data ?? null,
  };
  return NextResponse.json(snapshot);
}

export const GET = apiHandler(getHandler);
