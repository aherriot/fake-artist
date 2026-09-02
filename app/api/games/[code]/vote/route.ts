import { NextResponse } from "next/server";
import { apiHandler, readJson } from "@/lib/api";
import { getPlayerId } from "@/lib/session";
import { mutatePlayer } from "@/lib/game/private";
import { afterVote, clearVotes, readPrivateRows, resolveVote } from "@/lib/game/rounds";
import { broadcastAll } from "@/lib/pusher-server";
import { validateVote } from "@/lib/game/reduce";
import type { DraftEvent, PrivateState } from "@/lib/game/types";

export const preferredRegion = "iad1";
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
    const check = validateVote(targetId, {
      state: ctx.state,
      playerId,
      alreadyVoted: priv.vote !== null,
    });
    if (!check.ok) return { ok: false as const, error: check.error };

    const events: DraftEvent[] = [{ type: "player_voted", payload: { playerId } }];

    // Who still owes a vote? In a runoff the tied players vote too, but a
    // player may never vote for themselves, so they are excluded from their
    // own ballot requirement only where the rules already exclude them.
    const rows = await readPrivateRows(tx, ctx.gameId);
    const ballots: Record<string, string> = {};
    for (const r of rows) {
      const v = r.playerId === playerId ? targetId : r.data.vote;
      if (v) ballots[r.playerId] = v;
    }

    if (Object.keys(ballots).length === ctx.state.seatOrder.length) {
      const resolved = resolveVote(ctx.state, ballots);
      events.push(...resolved.events);

      // A tie opens a runoff and the round continues; otherwise the server --
      // which alone knows who the Fake Artist is -- decides whether this leads
      // to a guess or straight to the reveal.
      const goingToRunoff = resolved.tied.length > 1 && ctx.state.phase !== "runoff";
      if (goingToRunoff) {
        // Everyone votes again, so everyone's ballot must be cleared -- this
        // player's included, which is why it happens after the tally above.
        await clearVotes(tx, ctx.gameId, playerId);
        return { ok: true as const, data: { ...priv, vote: null }, events };
      }
      {
        const fake = rows.find((r) => r.data.role === "fake");
        const topic = rows.find((r) => r.data.role !== "fake")?.data.topic ?? "";
        events.push(
          afterVote(
            { ...ctx.state, votes: ballots, accusedId: resolved.accusedId },
            { accusedId: resolved.accusedId, fakeArtistId: fake?.playerId ?? "", topic },
          ),
        );
      }
    }

    return { ok: true as const, data: { ...priv, vote: targetId }, events };
  });

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.code });
  await broadcastAll(code.toUpperCase(), result.events);
  return NextResponse.json({ ok: true });
}

export const POST = apiHandler(postHandler);
