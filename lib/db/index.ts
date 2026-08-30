import { neon, Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle as drizzleHttp } from "drizzle-orm/neon-http";
import { drizzle as drizzleServerless } from "drizzle-orm/neon-serverless";
import * as schema from "./schema";

/**
 * Use Node's BUILT-IN WebSocket (global since Node 22), not the `ws` package.
 *
 * `ws` requires its optional native addon `bufferutil` inside a try/catch.
 * Next.js bundles that require into a stub that returns an empty object rather
 * than throwing, so `bufferUtil.mask` resolves to undefined and every
 * connection dies with "bufferUtil.mask is not a function". The global
 * WebSocket has no native addons and no bundler interaction.
 */
if (!neonConfig.webSocketConstructor) {
  const WS = (globalThis as { WebSocket?: unknown }).WebSocket;
  if (typeof WS !== "function") {
    throw new Error(
      "No global WebSocket. Node 22+ is required (or set neonConfig.webSocketConstructor).",
    );
  }
  neonConfig.webSocketConstructor = WS as NonNullable<typeof neonConfig.webSocketConstructor>;
}

function url(): string {
  const u = process.env.DATABASE_URL;
  if (!u) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.",
    );
  }
  if (!/^postgres(ql)?:\/\//.test(u)) {
    throw new Error("DATABASE_URL must start with postgresql://");
  }
  return u;
}

/** Warn once if the write path is pointed at a non-pooled endpoint. */
let warnedPooler = false;
function warnIfUnpooled(u: string) {
  if (warnedPooler || u.includes("-pooler.")) return;
  warnedPooler = true;
  console.warn(
    "[db] DATABASE_URL is not a Neon '-pooler' endpoint. Transactions will " +
      "open a direct connection per instance and can exhaust Postgres " +
      "connections under autoscaling. Use the pooled connection string.",
  );
}

/**
 * Both handles are created lazily behind a Proxy.
 *
 * Connecting at module scope would make `next build` require a live database
 * just to collect page data, and would burn a connection in every cold start
 * that never touches the DB.
 */
function lazy<T extends object>(make: () => T): T {
  let inner: T | null = null;
  return new Proxy({} as T, {
    get(_t, prop, recv) {
      inner ??= make();
      return Reflect.get(inner as object, prop, recv);
    },
  });
}

/**
 * READS. One-shot HTTP query; holds no connection.
 *
 * This is what survives autoscaling: N concurrent instances serving snapshot
 * and event reads consume zero Postgres backends. Cannot run multi-statement
 * transactions -- use `dbTx` for those.
 */
export const db = lazy(() => drizzleHttp(neon(url()), { schema }));

/**
 * WRITES. Pooled connection, used only inside transactions.
 *
 * DATABASE_URL should point at Neon's `-pooler` host so many short-lived
 * instances multiplex onto a few real backends. `max: 1` because a serverless
 * invocation handles one request at a time.
 */
export const dbTx = lazy(() => {
  const u = url();
  warnIfUnpooled(u);
  const pool = new Pool({ connectionString: u, max: 1 });
  // WITHOUT this, an idle client dropping its connection emits an unhandled
  // 'error' event, which Node escalates to an uncaughtException that takes
  // down the whole server. Neon closes idle connections aggressively, so this
  // is a routine event, not an exceptional one.
  pool.on("error", (err: Error) => {
    console.error("[db] idle pool client error (recovered):", err.message);
  });
  return drizzleServerless(pool, { schema });
});

export { schema };
