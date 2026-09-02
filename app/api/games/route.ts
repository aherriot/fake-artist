import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api";
import { sql } from "drizzle-orm";
import { dbTx } from "@/lib/db";
import { getOrCreatePlayerId } from "@/lib/session";
import { initialGameState } from "@/lib/game/types";
import { reduce } from "@/lib/game/reduce";

// Next.js requires these to be literal exports in the route file itself --
// re-exporting them from a shared module is silently ignored.
// preferredRegion pins the function to the Neon region so a distant player
// pays the cross-continent hop once, not twice. Change all at once with:
//   grep -rl 'preferredRegion' app | xargs sed -i '' 's/"cle1"/"fra1"/'
export const preferredRegion = "cle1";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Unambiguous alphabet: no O/0, I/1, so codes survive being read aloud.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const newCode = () =>
  Array.from({ length: 6 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join("");

/** POST /api/games -- create a game, seat the creator as host. */
async function postHandler(req: Request) {
  const { nickname } = (await req.json().catch(() => ({}))) as { nickname?: string };
  const name = (nickname ?? "").trim().slice(0, 24);
  if (!name) return NextResponse.json({ error: "Nickname required" }, { status: 400 });

  const playerId = await getOrCreatePlayerId();

  // Retry only guards against a code collision, which is vanishingly rare.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = newCode();
    try {
      const result = await dbTx.transaction(async (tx) => {
        const joined = { id: playerId, nickname: name, seat: 0 };
        const state = reduce(initialGameState(), {
          seq: 1,
          type: "player_joined",
          payload: joined,
        });

        const g = await tx.execute<{ id: string }>(sql`
          INSERT INTO games (code, status, state, version, host_id)
          VALUES (${code}, 'lobby', ${JSON.stringify(state)}::jsonb, 0, ${playerId}::uuid)
          RETURNING id
        `);
        const gameId = g.rows[0].id;

        await tx.execute(sql`
          INSERT INTO players (id, game_id, nickname, seat)
          VALUES (${playerId}::uuid, ${gameId}::uuid, ${name}, 0)
        `);
        await tx.execute(sql`
          INSERT INTO events (game_id, seq, type, payload)
          VALUES (${gameId}::uuid, 1, 'player_joined', ${JSON.stringify(joined)}::jsonb)
        `);
        return { gameId };
      });

      return NextResponse.json({ code, gameId: result.gameId, playerId });
    } catch (err) {
      const msg = String(err);
      if (msg.includes("games_code_idx") || msg.includes("duplicate key")) continue;
      throw err;
    }
  }
  return NextResponse.json({ error: "Could not allocate a game code" }, { status: 500 });
}

export const POST = apiHandler(postHandler);
