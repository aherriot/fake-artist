import { NextResponse } from "next/server";
import { apiHandler, readJson } from "@/lib/api";
import { getPlayerId } from "@/lib/session";
import { mutatePlayer } from "@/lib/game/private";
import { readPrivateRows, revealRound } from "@/lib/game/rounds";
import { broadcastAll } from "@/lib/pusher-server";
import type { DraftEvent, PrivateState } from "@/lib/game/types";

export const preferredRegion = "iad1";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/games/[code]/guess-vote -- do the real artists accept the guess?
 *
 * The Fake Artist is excluded: they win if it is accepted, so they do not get
 * to judge their own guess. Simple majority of the remaining players. A tie
 * counts as acceptance -- rejecting requires the room to actually agree.
 *
 * The last ballot also reveals the round, which is the single place a topic
 * and a Fake Artist's identity enter the event log. By then both are public.
 */
async function postHandler(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const playerId = await getPlayerId();
  if (!playerId) return NextResponse.json({ error: "No session" }, { status: 401 });

  const { accept } = await readJson<{ accept: boolean }>(req);
  if (typeof accept !== "boolean")
    return NextResponse.json({ error: "Invalid ballot" }, { status: 400 });

  const result = await mutatePlayer(code.toUpperCase(), playerId, async (ctx, tx) => {
    const priv = ctx.priv as unknown as PrivateState;
    if (ctx.state.phase !== "guess_vote")
      return { ok: false as const, error: "Not the guess vote" };
    if (priv.role === "fake")
      return { ok: false as const, error: "The fake artist cannot judge their own guess", code: 403 };
    if (priv.guessVote !== null)
      return { ok: false as const, error: "You have already voted" };

    const events: DraftEvent[] = [{ type: "guess_voted", payload: { playerId } }];

    const rows = await readPrivateRows(tx, ctx.gameId);
    const fake = rows.find((r) => r.data.role === "fake");
    const judges = rows.filter((r) => r.data.role !== "fake");
    const ballots = judges.map((r) =>
      r.playerId === playerId ? (accept ? "accept" : "reject") : r.data.guessVote,
    );

    if (ballots.every((b) => b !== null)) {
      const accepts = ballots.filter((b) => b === "accept").length;
      // Ties favour the Fake Artist: rejecting takes a real majority.
      const accepted = accepts * 2 >= ballots.length;
      const topic = judges[0]?.data.topic ?? "";
      events.push(
        revealRound(ctx.state, {
          fakeArtistId: fake?.playerId ?? "",
          topic,
          caught: true,
          guess: ctx.state.guess,
          guessAccepted: accepted,
        }),
      );
    }

    return {
      ok: true as const,
      data: { ...priv, guessVote: accept ? ("accept" as const) : ("reject" as const) },
      events,
    };
  });

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.code });
  await broadcastAll(code.toUpperCase(), result.events);
  return NextResponse.json({ ok: true });
}

export const POST = apiHandler(postHandler);
