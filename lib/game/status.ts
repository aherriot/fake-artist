import { currentDrawer, type GameState, type PlayerInfo, type PrivateState } from "./types";

/**
 * Whose move is it, and what is it?
 *
 * Pure, so the single most important thing on screen -- "must I act right
 * now?" -- is decided in one place for every phase and can be tested, rather
 * than reconstructed by each panel with slightly different conditions.
 */
export interface TurnStatus {
  /** The viewer must act now. Drives the loudest styling on the page. */
  yours: boolean;
  headline: string;
  detail?: string;
  /** Nicknames the game is waiting on, when it is not the viewer. */
  waitingOn: string[];
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
}): TurnStatus {
  const { state, you, hostId, players, privateState } = args;
  const name = (id: string | null) =>
    players.find((p) => p.id === id)?.nickname ?? "someone";
  const names = (ids: string[]) => ids.map(name);
  const isHost = you !== null && you === hostId;

  switch (state.phase) {
    case "lobby":
      return isHost
        ? { yours: true, headline: "Start the match when everyone is in", waitingOn: [] }
        : { yours: false, headline: `Waiting for ${name(hostId)} to start`, waitingOn: [name(hostId)] };

    case "drawing": {
      const drawer = currentDrawer(state);
      if (drawer && drawer === you) {
        return {
          yours: true,
          headline: "Your turn — draw one continuous line",
          detail: "Press and drag without lifting. You can undo before submitting.",
          waitingOn: [],
        };
      }
      return {
        yours: false,
        headline: `Waiting for ${name(drawer)} to draw`,
        waitingOn: drawer ? [name(drawer)] : [],
      };
    }

    case "voting":
    case "runoff": {
      const done = args.voted || (you !== null && state.voted.includes(you));
      const outstanding = players.filter((p) => !state.voted.includes(p.id)).map((p) => p.nickname);
      if (!done) {
        return {
          yours: true,
          headline:
            state.phase === "runoff"
              ? "The vote tied — vote again"
              : "Talk it over, then vote for the fake artist",
          detail:
            state.phase === "runoff"
              ? "Only the tied players can be chosen."
              : "Who drew like someone who did not know what this was? Everyone's vote is revealed at the same time.",
          waitingOn: [],
        };
      }
      return {
        yours: false,
        headline: `Waiting for ${listOf(outstanding)} to vote`,
        waitingOn: outstanding,
      };
    }

    case "guess": {
      if (state.accusedId === you) {
        return {
          yours: true,
          headline: "You were caught — name the subject",
          detail: "Get it right and you still win the round.",
          waitingOn: [],
        };
      }
      return {
        yours: false,
        headline: `Waiting for ${name(state.accusedId)} to guess`,
        waitingOn: [name(state.accusedId)],
      };
    }

    case "guess_vote": {
      const outstanding = players
        .filter((p) => p.id !== state.accusedId && !state.guessVoted.includes(p.id))
        .map((p) => p.nickname);
      if (privateState?.role === "fake") {
        return {
          yours: false,
          headline: "The others are deciding whether your guess counts",
          waitingOn: outstanding,
        };
      }
      const done = you !== null && state.guessVoted.includes(you);
      if (!done) {
        return {
          yours: true,
          headline: "Does that guess count?",
          detail: "A tie counts as accepted.",
          waitingOn: [],
        };
      }
      return { yours: false, headline: `Waiting for ${listOf(outstanding)}`, waitingOn: outstanding };
    }

    case "reveal":
      return isHost
        ? {
            yours: true,
            headline:
              state.round >= state.totalRounds
                ? "Finish the match when everyone has seen this"
                : "Start the next round when everyone has seen this",
            waitingOn: [],
          }
        : { yours: false, headline: `Waiting for ${name(hostId)} to continue`, waitingOn: [name(hostId)] };

    case "complete":
      return { yours: false, headline: "The match is over", waitingOn: [] };

    default:
      return { yours: false, headline: "", waitingOn: [] };
  }
}

/** "Alice", "Alice and Bob", "Alice, Bob and 3 others". */
export function listOf(names: string[]): string {
  if (names.length === 0) return "everyone";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  if (names.length === 3) return `${names[0]}, ${names[1]} and ${names[2]}`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} others`;
}
