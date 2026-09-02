/**
 * Runs before `npm run dev`.
 *
 * Exists because a database with no schema produced a raw Postgres error on
 * the first click and nothing anywhere said "run db:push". The integration
 * suite could never catch it: that harness applies the schema to a throwaway
 * database every run, so a stale or empty real database is invisible to it.
 *
 * Warns loudly and continues -- a transient network blip should not stop you
 * working on the UI.
 */
const RESET = "\x1b[0m", RED = "\x1b[31m", YELLOW = "\x1b[33m", DIM = "\x1b[2m";
const banner = (colour, lines) => {
  const w = Math.max(...lines.map((l) => l.length)) + 4;
  console.log(`\n${colour}${"─".repeat(w)}`);
  for (const l of lines) console.log(`  ${l}`);
  console.log(`${"─".repeat(w)}${RESET}\n`);
};

try {
  process.loadEnvFile(".env.local");
} catch {
  /* CI and Vercel pass real env vars instead. */
}

const missing = ["DATABASE_URL", "SESSION_SECRET"].filter((k) => !process.env[k]);
if (missing.length) {
  banner(RED, [
    `Missing required env: ${missing.join(", ")}`,
    "",
    "Copy .env.example to .env.local and fill it in.",
    "Generate secrets with: openssl rand -base64 32",
  ]);
  process.exit(0);
}

const REQUIRED = ["games", "players", "events", "player_state"];
try {
  const { neon } = await import("@neondatabase/serverless");
  const isNeon = /neon\.tech|neon\.build/.test(process.env.DATABASE_URL);
  let present = [];

  if (isNeon) {
    const sql = neon(process.env.DATABASE_URL);
    const rows = await sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`;
    present = rows.map((r) => r.tablename);
  } else {
    const pg = (await import("pg")).default;
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    const { rows } = await pool.query(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public'",
    );
    present = rows.map((r) => r.tablename);
    await pool.end();
  }

  const absent = REQUIRED.filter((t) => !present.includes(t));
  if (absent.length === REQUIRED.length) {
    banner(RED, [
      "The database has no schema.",
      "",
      "Run:  npm run db:push",
      "",
      DIM + "Every API call will fail with 503 until you do." + RESET,
    ]);
  } else if (absent.length > 0) {
    banner(YELLOW, [
      `Schema is out of date. Missing: ${absent.join(", ")}`,
      "",
      "Run:  npm run db:push",
    ]);
  }
} catch (err) {
  banner(YELLOW, [
    "Could not reach the database to check the schema.",
    "",
    String(err?.message ?? err).slice(0, 100),
    "",
    DIM + "Starting anyway." + RESET,
  ]);
}
