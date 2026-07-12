#!/usr/bin/env bash
# One-shot devnet go-live once the keeper wallet is funded (~5 devnet SOL):
#   1. deploy the program        2. subscribe + activate TxLINE free tier
#   3. build the UI              4. start keeper+API with the demo autoloop
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== 1/4 deploy program =="
bash scripts/deploy-program.sh

echo "== 2/4 TxLINE devnet subscription =="
test -f .env.devnet || node scripts/setup-devnet.mjs

echo "== 3/4 build web =="
npm run build -w web

echo "== 4/4 start server =="
DEMO_AUTOLOOP=1 npm start -w server
