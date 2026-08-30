import type { Config } from "drizzle-kit";

// Next.js loads .env.local automatically, but drizzle-kit runs outside Next.
// process.loadEnvFile is built into Node >= 21.
try {
  process.loadEnvFile(".env.local");
} catch {
  // Fine when the file is absent (e.g. CI passing DATABASE_URL directly).
}

export default {
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL! },
} satisfies Config;
