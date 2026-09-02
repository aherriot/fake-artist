import { NextResponse } from "next/server";
import { apiHandler, readJson } from "@/lib/api";
import { getPlayerId } from "@/lib/session";
import { mutate } from "@/lib/game/mutate";
import { readPrivateRows } from "@/lib/game/rounds";
import { broadcastAll } from "@/lib/pusher-server";

export const preferredRegion = "cle1";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/games/[code]/guess -- the caught Fake Artist names the topic.
 *
 * The guess is public the instant it is made: everyone needs to see it in
 * order to vote on whether it counts. Only the accused player may submit, and
 * only while the round is waiting on them.
 */
async function postHandler(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const playerId = await getPlayerId();
  if (!playerId) return NextResponse.json({ error: "No session" }, { status: 401 });

  const { guess } = await readJson<{ guess: string }>(req);
  const text = (guess ?? "").trim().slice(0, 80);
  if (!text) return NextResponse.json({ error: "Enter a guess" }, { status: 400 });

  const result = await mutate(code.toUpperCase(), async (ctx, tx) => {
    if (ctx.state.phase !== "guess")
      return { ok: false as const, error: "Not the guessing phase" };
    if (ctx.state.accusedId !== playerId)
      return { ok: false as const, error: "Only the accused player may guess" };

    // Belt and braces: confirm from private state that the accused really is
    // the Fake Artist before accepting a guess.
    const rows = await readPrivateRows(tx, ctx.gameId);
    const me = rows.find((r) => r.playerId === playerId);
    if (me?.data.role !== "fake")
      return { ok: false as const, error: "You are not the fake artist" };

    return {
      ok: true as const,
      produced: { events: [{ type: "guess_submitted" as const, payload: { guess: text } }] },
    };
  });

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.code });
  await broadcastAll(code.toUpperCase(), result.events);
  return NextResponse.json({ ok: true });
}

export const POST = apiHandler(postHandler);
