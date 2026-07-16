# 🏁 Final Whistle

**Trustless World Cup prediction markets on Solana — settled the second the whistle blows, by cryptographic proof instead of trust.**

Built for the TxODDS World Cup hackathon (*Prediction Markets and Settlement* track).

<p align="center">
  <a href="https://finalwhistle-1sck.onrender.com"><img src="https://img.shields.io/badge/Live%20MVP-online-16a34a?style=flat-square" alt="Live MVP"></a>
  <img src="https://img.shields.io/badge/Solana-devnet-9945FF?style=flat-square&logo=solana&logoColor=white" alt="Solana devnet">
  <img src="https://img.shields.io/badge/Anchor-0.31-512BD4?style=flat-square" alt="Anchor 0.31">
  <img src="https://img.shields.io/badge/settlement-CPI%20%E2%86%92%20validate__stat__v2-0ea5e9?style=flat-square" alt="CPI validate_stat_v2">
  <img src="https://img.shields.io/badge/license-MIT-111?style=flat-square" alt="MIT">
</p>

**▶ Live MVP:** https://finalwhistle-1sck.onrender.com &nbsp;·&nbsp; **Demo video:** _add YouTube/Loom link_ &nbsp;·&nbsp; **Deep-dive:** [`docs/TECHNICAL.md`](docs/TECHNICAL.md)

<p align="center">
  <em>Stakes live in an escrow no one controls. When the match is finalised, anyone can hand the escrow<br/>
  TxLINE's Merkle proof — the escrow verifies it on-chain and pays the winners. No oracle committee. No admin key.</em>
</p>

---

## Proof it works — a real World Cup match, settled on-chain

Everything below is **real on-chain state on Solana devnet**, produced from TxLINE Merkle proofs — not mockups or screenshots. Click any signature to open Solana Explorer.

**England 1–2 Argentina** — a real fixture (`18241006`), settled by the escrow's CPI into TxLINE `validate_stat_v2`:

| Action | Market | On-chain transaction |
|---|---|---|
| ✅ Settle · Away win | winner `2c9tVujo…43ZSr` | [`de1azpUT…f5Abdv`](https://explorer.solana.com/tx/de1azpUTtdxuAjZxHX8QT13DxJ6Z7nYthAUcb5wAQi9sfw4U5S43D5twkFRWamkqqXRkSndJjYdtbNyNyf5Abdv?cluster=devnet) |
| ✅ Settle · Over 2.5 | totals `DAZruDXC…jnaQh` | [`3WKM774w…DMGrGm`](https://explorer.solana.com/tx/3WKM774wNPrcHD55AscivVLrKtctqQD1iRjHFoGsfrq9mWYCQTWq3hbMvyigycZrYDFTwprSM7mYLeSXChDMGrGm?cluster=devnet) |
| 💰 Claim 0.4015 SOL | winning pool | [`4ZUXZ61c…1oHbHUU`](https://explorer.solana.com/tx/4ZUXZ61cBimSgUFZzd3fWumWwF5rJUVdWfWNMfjap1JN5y5ZZX5YT97Can4RxRS4dhmY2jwYX9Us7xvk21oHbHUU?cluster=devnet) |
| 💰 Claim 0.1015 SOL | winning pool | [`5Xv7uMrS…1TFgb9`](https://explorer.solana.com/tx/5Xv7uMrSs9ppnECXLftuLsMbWWPYDbw3g9EVeeYa3R2WWeyYrvc1ZVWuURqntcXALZfkdWGD996yCJPLyd1TFgb9?cluster=devnet) |

The program verified TxLINE's proof against the anchored daily Merkle root **before releasing a single lamport**. A wrong outcome could not have been claimed — the proof itself refutes it — and losing stakes flowed into the winning pools. Re-verify any settlement yourself from its stored proof with [`scripts/verify-proof.mjs`](scripts/verify-proof.mjs), or from the receipt page's in-browser **"Verify"** button.

## What it does

1. **Auto-markets.** A keeper reads the TxLINE fixtures feed and opens parimutuel pools on-chain for every covered fixture: match winner (1X2) and total goals (O/U 2.5). Anyone can open additional markets — addresses are deterministic PDAs, creation is permissionless.
2. **Live experience.** The web app streams TxLINE's real-time scores and consensus odds (SSE) — live scoreboards, a match event feed (goals, cards, corners, VAR), implied-probability charts and price-movement history.
3. **Trustless settlement.** When TxLINE emits the `game_finalised` record (`period 100`), the keeper fetches the Merkle proof for the final stats (`/api/scores/stat-validation`) and calls the escrow's `settle` instruction. The escrow program **CPIs into TxLINE's `validate_stat_v2`** and only unlocks funds if the oracle program verifies the proof against the daily Merkle root anchored on Solana by TxODDS.
4. **Verifiable receipts.** Every settled market gets a receipt page showing the full evidence chain — final stats, the exact predicate that was proven, the Merkle path sizes, the root PDA and the settlement transaction — plus a **"Verify in my browser"** button that re-runs `validate_stat_v2` as a read-only simulation from the visitor's own browser. Don't trust us; ask the chain.

### Why the settlement is actually trustless

The `settle` instruction is **permissionless** — any keeper, any user, anyone can call it. Cheating is prevented by four deterministic check gates inside the program (`program/programs/finalwhistle/src/lib.rs`):

| Gate | What it stops |
|---|---|
| `payload.fixture_id == market.fixture_id` | proofs from a different match |
| stat keys must be the market's settlement keys, `period == 100` | proofs of half-time / in-play records posing as final |
| roots account must be the canonical TxLINE `daily_scores_roots` PDA for the proof's epoch day | attacker-supplied root accounts |
| predicate is **built by the program** from market params + claimed outcome, then proven via CPI `validate_stat_v2 == true` | claiming the wrong winner — the Merkle proof itself refutes it |

If nobody can produce a valid proof (fixture cancelled, coverage dropped), a time-locked `void_expired` path lets every bettor reclaim their stake. No funds can get stuck; no human can pick winners.

## Architecture

```
   TxLINE devnet feed                     Solana devnet
┌───────────────────────┐        ┌──────────────────────────────┐
│ fixtures / scores SSE │        │  finalwhistle (this program) │
│ odds SSE              │        │   create_market / place_bet  │
│ stat-validation       │        │   settle ──CPI──▶ txoracle   │
└──────────┬────────────┘        │   claim / void_expired  ▲    │
           │                     └─────────────────────────┼────┘
           ▼                                               │
   ┌──────────────┐   settle(proof)                        │
   │ server/      │──────────────────────────────────────ticks
   │ keeper + API │   SSE relay, REST                 daily Merkle
   └──────┬───────┘                                   roots (TxODDS)
          ▼
   ┌──────────────┐   place_bet / claim (wallet)
   │ web/  React  │──────────────────────────────▶ user's wallet
   │ + receipts   │   verify receipt = browser-side simulation
   └──────────────┘
```

- **`program/`** — Anchor program (Rust). Parimutuel escrow + proof-gated settlement via `declare_program!(txoracle)` CPI.
- **`server/`** — TypeScript keeper: TxLINE auth, fixtures→markets sync, SSE ingest + relay, settlement bot, demo replay.
- **`web/`** — React (Vite + Tailwind). Live markets, wallet betting, portfolio, verifiable receipts.
- **`scripts/`** — devnet setup (wallet, TxLINE free-tier subscription, token activation).

## Quick start

```bash
npm install                        # root, server and web workspaces

# fund .keys/keeper.json with ~5 devnet SOL (from the public devnet dispenser), then:
bash scripts/go-live.sh            # deploy + subscribe + build + start

# or step by step:
node scripts/setup-devnet.mjs      # wallet + TxLINE free tier + API token -> .env.devnet
bash scripts/deploy-program.sh     # deploy program/target/deploy/finalwhistle.so
npm run dev -w server              # keeper + API on :8787
npm run dev -w web                 # UI on :5173 (proxies /api)
```

Tests: `cargo test` in `program/programs/finalwhistle` (predicate/payout units), plus two
on-chain suites against a local validator — `scripts/smoke-test.mjs` (market lifecycle) and
`scripts/smoke-test-settle.mjs` (settlement gates, CPI return data, payouts; uses
`program/mock-oracle` loaded at the txoracle address).

Production: `npm run build -w web` then `npm start -w server` — the server serves the built UI and everything runs off one port. A `Dockerfile` is included.

### Demo replay (because judging happens after the final)

Matches end before review, so the server includes a **replay mode** that re-broadcasts a finished fixture's *real* TxLINE score records as if live, then performs a *real* on-chain settlement with the *real* Merkle proof of its finalised record — only the pacing is simulated:

```bash
curl -X POST "http://localhost:8787/api/demo/start?fixtureId=<id>&speed=4&bettingSecs=60"
```

## TxLINE endpoints used

| Endpoint | Used for |
|---|---|
| `POST /auth/guest/start` | guest JWT (auto-renewed on 401) |
| on-chain `subscribe` + `POST /api/token/activate` | devnet free-tier API token |
| `GET /api/fixtures/snapshot` | fixture discovery → auto market creation |
| `GET /api/scores/stream` (SSE) | live scoreboards, event feed, finalisation detection |
| `GET /api/odds/stream` (SSE) | consensus odds, implied probability, price history |
| `GET /api/scores/snapshot/{id}`, `/api/scores/historical/{id}` | state recovery + demo replay |
| `GET /api/scores/stat-validation?statKeys=…` | Merkle proofs for settlement (`validateStatV2` shape) |
| on-chain `txoracle.validate_stat_v2` (CPI + browser simulation) | trustless outcome verification |

## Program addresses (devnet)

| What | Address |
|---|---|
| Final Whistle program | `3pqHn5WcqLpHRcZDP6FKTSez7VmjeDDzzuxb72FUoB3P` |
| TxLINE txoracle | `6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J` |

## Docs

- [`docs/TECHNICAL.md`](docs/TECHNICAL.md) — architecture deep-dive, settlement pipeline, threat model
- [`docs/FEEDBACK.md`](docs/FEEDBACK.md) — our TxLINE API experience (what we loved, where we hit friction)

## License

MIT
