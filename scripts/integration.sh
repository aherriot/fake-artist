#!/usr/bin/env bash
#
# Boots a throwaway Postgres and the real Next server, runs the HTTP suite,
# then tears both down. No Neon account and no network required, so this can
# run on every change and in CI.
set -euo pipefail
cd "$(dirname "$0")/.."

PORT="${TEST_PORT:-3060}"
PGPORT="${TEST_PGPORT:-55440}"
WORK="$(mktemp -d)"
export PGDATA="$WORK/pg" PGHOST="$WORK/sock"

cleanup() {
  [ -n "${NEXT_PID:-}" ] && kill "$NEXT_PID" 2>/dev/null || true
  pg_ctl -D "$PGDATA" stop -m immediate >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

command -v initdb >/dev/null || { echo "postgres not found (brew install postgresql)"; exit 1; }

echo "==> starting throwaway postgres on $PGPORT"
mkdir -p "$PGHOST"
initdb -D "$PGDATA" -U postgres --auth=trust >/dev/null 2>&1
pg_ctl -D "$PGDATA" -o "-p $PGPORT -k $PGHOST -c listen_addresses=''" \
  -l "$WORK/pg.log" start >/dev/null 2>&1
for i in $(seq 1 30); do
  psql -h "$PGHOST" -p "$PGPORT" -U postgres -c 'SELECT 1' >/dev/null 2>&1 && break
  sleep 1
done
psql -h "$PGHOST" -p "$PGPORT" -U postgres -q -c 'CREATE DATABASE app' >/dev/null

# A unix-socket URL keeps this off the network entirely.
export DATABASE_URL="postgresql://postgres@localhost/app?host=$PGHOST&port=$PGPORT"
export SESSION_SECRET="integration-test-secret"
export CRON_SECRET="integration-cron-secret"
# Absent Pusher config is itself under test: broadcast() must degrade quietly.
unset PUSHER_APP_ID PUSHER_SECRET NEXT_PUBLIC_PUSHER_KEY NEXT_PUBLIC_PUSHER_CLUSTER || true
# Pin every game-rule flag explicitly. NEXT_PUBLIC_* is inlined at build time,
# so without this the suite silently inherits whatever is in the developer's
# .env.local -- which is how enabling 2-player mode locally broke the
# minimum-players test.
export NEXT_PUBLIC_ALLOW_TWO_PLAYER_GAMES="0"

echo "==> applying schema"
npx drizzle-kit push --force >/dev/null 2>&1

echo "==> building"
npx next build >"$WORK/build.log" 2>&1 || { tail -30 "$WORK/build.log"; exit 1; }

echo "==> starting app on $PORT"
npx next start -p "$PORT" >"$WORK/next.log" 2>&1 &
NEXT_PID=$!
for i in $(seq 1 40); do
  curl -sf -o /dev/null "http://localhost:$PORT/" && break
  sleep 1
done

echo "==> running integration suite"
set +e
TEST_BASE_URL="http://localhost:$PORT" node test/integration.mjs
STATUS=$?
set -e
[ $STATUS -ne 0 ] && { echo "--- server log ---"; tail -40 "$WORK/next.log"; }
exit $STATUS
