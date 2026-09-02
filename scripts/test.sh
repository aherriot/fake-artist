#!/usr/bin/env bash
# Tests the pure reducer -- the half of the sync guarantee that runs client-side.
# Compiles just the two pure modules, then runs assertions on plain Node.
set -euo pipefail
cd "$(dirname "$0")/.."
rm -rf .test-build
npx tsc lib/game/reduce.ts lib/game/types.ts lib/game/words.ts lib/game/optimistic.ts --outDir .test-build \
  --module esnext --target es2022 --moduleResolution bundler
# tsc keeps extensionless specifiers; Node's ESM resolver needs them explicit.
sed -i '' 's|from "./types"|from "./types.js"|' .test-build/reduce.js .test-build/optimistic.js
# Mark only the compiled output as ESM; the app package stays CJS-default.
echo '{"type":"module"}' > .test-build/package.json
node test/reduce.test.mjs
