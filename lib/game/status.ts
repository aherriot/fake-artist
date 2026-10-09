import { currentDrawer, type GameState, type PlayerInfo, type PrivateState } from "./types";
import { activePlayers } from "./reduce";

/**
 * Whose move is it, and what is it?
 *
 * Pure, so the single most important thing on screen -- "must I act right
 * now?" -- is decided in one place for every phase and can be tested, rather
 * than reconstructed by each panel with slightly different conditions.
 *
 * The headline is a list of SEGMENTS rather than a string, so the UI can paint
 * each player's name in their own pen colour. Baking names into a sentence
 * would make "waiting for Cara" and Cara's green line on the canvas look like
 * unrelated facts.
 */
export type Segment = string | { player: string };

export interface TurnStatus {
  /** The viewer must act now. Drives the loudest styling on the page. */
  yours: boolean;
  headline: Segment[];
  detail?: string;
  /** Player ids the game is waiting on, when it is not the viewer. */
  waitingOn: string[];
}

/** Flatten a headline for tests, aria-labels and anywhere plain text is needed. */
export function headlineText(
  headline: Segment[],
  players: { id: string; nickname: string }[],
): string {
  return headline
    .map((s) =>
      typeof s === "string"
        ? s
        : (players.find((p) => p.id === s.player)?.nickname ?? "someone"),
    )
    .join("");
}

/** "a", "a and b", "a, b and c", "a, b and 2 others" -- as segments. */
export function nameList(ids: string[], max = 3): Segment[] {
  if (ids.length === 0) return ["everyone"];
  const shown = ids.slice(0, max);
  const rest = ids.length - shown.length;
  const out: Segment[] = [];
  shown.forEach((id, i) => {
    if (i > 0) out.push(i === shown.length - 1 && rest === 0 ? " and " : ", ");
    out.push({ player: id });
  });
  if (rest > 0) out.push(` and ${rest} other${rest === 1 ? "" : "s"}`);
  return out;
}

export function turnStatus(args: {
  state: GameState;
  you: string | null;
  hostId: string | null;
  players: PlayerInfo[];
  privateState: PrivateState | null;
  /** Optimistic: treat the viewer as already done, so the board does not
   *  flicker back to "your move" between the click and the confirmation. */
  voted?: boolean;
  /** Optimistic: the viewer's line is on its way, so their turn is over. */
  drew?: boolean;
}): TurnStatus {
  const { state, you, hostId, privateState } = args;
  const isHost = you !== null && you === hostId;
  const waitFor = (ids: string[], suffix: string): TurnStatus => ({
    yours: false,
    headline: ["Waiting for ", ...nameList(ids), suffix],
    waitingOn: ids,
  });
  // Nothing in a round waits on a player the host has dropped, so no list of
  // who is outstanding may name them -- and they must not be told to act.
  const active = activePlayers(state);
  const inRound = state.phase !== "lobby" && state.phase !== "reveal" && state.phase !== "complete";
  if (inRound && you !== null && state.absent.includes(you)) {
    return {
      yours: false,
      headline: ["You were dropped from this round"],
      detail: "You will be dealt back in when the next round starts.",
      waitingOn: [],
    };
  }

  switch (state.phase) {
    case "lobby":
      return isHost
        ? { yours: true, headline: ["Start the match when everyone is in"], waitingOn: [] }
        : waitFor(hostId ? [hostId] : [], " to start");

    case "drawing": {
      const drawer = currentDrawer(state);
      if (drawer && drawer === you && args.drew) {
        return { yours: false, headline: ["Sending your line…"], waitingOn: [] };
      }
      if (drawer && drawer === you) {
        return {
          yours: true,
          headline: ["Your turn — draw one continuous line"],
          detail: "Press and drag without lifting. You can undo before submitting.",
          waitingOn: [],
        };
      }
      return waitFor(drawer ? [drawer] : [], " to draw");
    }

    case "voting":
    case "runoff": {
      const done = args.voted || (you !== null && state.voted.includes(you));
      const outstanding = active.filter((id) => !state.voted.includes(id));
      if (!done) {
        return {
          yours: true,
          headline: [
            state.phase === "runoff"
              ? "The vote tied — vote again"
              : "Talk it over, then vote for the fake artist",
          ],
          detail:
            state.phase === "runoff"
              ? "Only the tied players can be chosen."
              : "Who drew like someone who did not know what this was? Everyone's vote is revealed at the same time.",
          waitingOn: [],
        };
      }
      return waitFor(outstanding, " to vote");
    }

    case "guess": {
      if (state.accusedId === you) {
        return {
          yours: true,
          headline: ["You were caught — name the subject"],
          detail: "Get it right and you still win the round.",
          waitingOn: [],
        };
      }
      return waitFor(state.accusedId ? [state.accusedId] : [], " to guess");
    }

    case "guess_vote": {
      const outstanding = active.filter(
        (id) => id !== state.accusedId && !state.guessVoted.includes(id),
      );
      if (privateState?.role === "fake") {
        return {
          yours: false,
          headline: ["The others are deciding whether your guess counts"],
          waitingOn: outstanding,
        };
      }
      const done = you !== null && state.guessVoted.includes(you);
      if (!done) {
        return {
          yours: true,
          headline: ["Does that guess count?"],
          detail: "It counts if at least half of you accept it — a tie counts.",
          waitingOn: [],
        };
      }
      return waitFor(outstanding, "");
    }

    case "reveal":
      return isHost
        ? {
            yours: true,
            headline: [
              state.round >= state.totalRounds
                ? "Finish the match when everyone has seen this"
                : "Start the next round when everyone has seen this",
            ],
            waitingOn: [],
          }
        : waitFor(hostId ? [hostId] : [], " to continue");

    case "complete":
      return { yours: false, headline: ["The match is over"], waitingOn: [] };

    default:
      return { yours: false, headline: [], waitingOn: [] };
  }
}
