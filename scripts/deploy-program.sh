#!/usr/bin/env bash
# Deploy the finalwhistle program to devnet.
# Requires: solana CLI on PATH, a funded keeper wallet (.keys/keeper.json),
# and the built artifact program/target/deploy/finalwhistle.so.
set -euo pipefail
cd "$(dirname "$0")/.."

SO=program/target/deploy/finalwhistle.so
KEYPAIR=program/target/deploy/finalwhistle-keypair.json
PAYER=.keys/keeper.json
RPC="${RPC_URL:-https://api.devnet.solana.com}"

test -f "$SO" || { echo "missing $SO — build first (see program/)"; exit 1; }
test -f "$KEYPAIR" || { echo "missing $KEYPAIR"; exit 1; }

echo "Program id: $(solana-keygen pubkey "$KEYPAIR")"
echo "Payer:      $(solana-keygen pubkey "$PAYER")"
solana program deploy "$SO" \
  --program-id "$KEYPAIR" \
  --keypair "$PAYER" \
  --url "$RPC"
