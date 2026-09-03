import { NextResponse } from "next/server";
import { apiHandler, readJson } from "@/lib/api";
import { getPlayerId } from "@/lib/session";
import { mutatePlayer } from "@/lib/game/private";
import { clearVotes, resolveIfComplete } from "@/lib/game/rounds";
import { broadcastAll } from "@/lib/pusher-server";
import { validateVote } from "@/lib/game/reduce";
import type { DraftEvent, PrivateState } from "@/lib/game/types";

export const preferredRegion = "cle1";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/games/[code]/vote -- cast a SECRET vote.
 *
 * The vote goes to the voter's own private row. Only `player_voted` is
 * appended to the log, which says that someone voted, not who for. The ballot
 * becomes public in one step when the last vote lands, so nobody can watch the
 * count build and vote strategically.
 */
async function postHandler(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const playerId = await getPlayerId();
  if (!playerId) return NextResponse.json({ error: "No session" }, { status: 401 });

  const { targetId } = await readJson<{ targetId: string }>(req);
  if (typeof targetId !== "string")
    return NextResponse.json({ error: "Invalid vote" }, { status: 400 });

  const result = await mutatePlayer(code.toUpperCase(), playerId, async (ctx, tx) => {
    const priv = ctx.priv as unknown as PrivateState;
    const check = validateVote(targetId, { state: ctx.state, playerId });
    if (!check.ok) return { ok: false as const, error: check.error };

    // Changing an existing vote is not news: the public fact "they have voted"
    // is already recorded, and re-announcing it would be a duplicate event.
    const changing = priv.vote !== null;
    const events: DraftEvent[] = changing
      ? []
      : [{ type: "player_voted", payload: { playerId } }];

    const resolved = await resolveIfComplete(tx, ctx.gameId, ctx.state, {
      playerId,
      vote: targetId,
    });
    events.push(...resolved);

    // A tie opens a runoff, and everyone votes again -- so every ballot is
    // cleared, this player's included, which is why it happens after the tally.
    if (resolved.some((e) => e.type === "voting_started")) {
      await clearVotes(tx, ctx.gameId, playerId);
      return { ok: true as const, data: { ...priv, vote: null }, events };
    }

    return { ok: true as const, data: { ...priv, vote: targetId }, events };
  });

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.code });
  await broadcastAll(code.toUpperCase(), result.events);
  return NextResponse.json({ ok: true });
}

export const POST = apiHandler(postHandler);
