#!/usr/bin/env bash
# Tests the pure modules -- the half of the guarantees that run client-side.
# Compiles just those files, then runs assertions on plain Node.
set -euo pipefail
cd "$(dirname "$0")/.."
rm -rf .test-build
# --rootDir keeps the output layout stable (game/, ui/) no matter which files
# are listed; without it tsc re-roots on the common ancestor and the paths move
# every time a file from a new directory is added.
npx tsc \
  lib/game/reduce.ts lib/game/types.ts lib/game/words.ts \
  lib/game/optimistic.ts lib/game/status.ts lib/ui/rememberedName.ts \
  --rootDir lib --outDir .test-build \
  --module esnext --target es2022 --moduleResolution bundler
# tsc keeps extensionless specifiers; Node's ESM resolver needs them explicit.
sed -i '' 's|from "./types"|from "./types.js"|' .test-build/game/*.js
# Mark only the compiled output as ESM; the app package stays CJS-default.
echo '{"type":"module"}' > .test-build/package.json
node test/reduce.test.mjs
