import { NextResponse } from "next/server";

/** An error with an intended HTTP status. Thrown by routes, rendered as JSON. */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Map low-level driver failures onto something a user can act on. */
function classify(err: unknown): { status: number; message: string } {
  const msg = err instanceof Error ? err.message : String(err);

  if (/DATABASE_URL/.test(msg))
    return { status: 503, message: "Database is not configured on the server." };
  if (/Connection terminated|ECONNREFUSED|ETIMEDOUT|fetch failed|socket hang up/i.test(msg))
    return { status: 503, message: "Database is unreachable. Please retry." };
  if (/bufferUtil|WebSocket/i.test(msg))
    return { status: 503, message: "Database connection transport failed." };
  if (/duplicate key/i.test(msg))
    return { status: 409, message: "Conflict, please retry." };

  return { status: 500, message: "Internal server error." };
}

/**
 * Wraps a route handler so it ALWAYS returns a JSON body.
 *
 * Without this, an unexpected throw yields Next's default empty 500, and the
 * client's `res.json()` dies with "unexpected end of data" -- which hides the
 * real error behind a parse failure. Every response from here is parseable,
 * and carries a requestId that also appears in the server log.
 */
export function apiHandler<Ctx>(
  fn: (req: Request, ctx: Ctx) => Promise<Response>,
): (req: Request, ctx: Ctx) => Promise<Response> {
  return async (req: Request, ctx: Ctx) => {
    const requestId = crypto.randomUUID().slice(0, 8);
    try {
      return await fn(req, ctx);
    } catch (err) {
      if (err instanceof ApiError) {
        return NextResponse.json({ error: err.message, requestId }, { status: err.status });
      }
      const { status, message } = classify(err);
      console.error(`[api:${requestId}] ${req.method} ${new URL(req.url).pathname}`, err);
      return NextResponse.json(
        {
          error: message,
          requestId,
          // Never leak internals in production; invaluable in dev.
          detail:
            process.env.NODE_ENV === "production"
              ? undefined
              : err instanceof Error
                ? err.message
                : String(err),
        },
        { status },
      );
    }
  };
}

/** Parse a JSON body without throwing on malformed input. */
export async function readJson<T>(req: Request): Promise<Partial<T>> {
  try {
    const body = await req.json();
    return body && typeof body === "object" ? (body as Partial<T>) : {};
  } catch {
    return {};
  }
}
