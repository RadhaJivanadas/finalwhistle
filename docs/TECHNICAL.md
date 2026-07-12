# Final Whistle — technical documentation

## Core idea

A prediction market is only as honest as its settlement. Final Whistle removes the settlement
trust assumption entirely: market outcomes are decided by **TxLINE's cryptographically anchored
match data**, verified **inside the Solana runtime** at the moment funds are released.

The escrow program never trusts our backend. The backend (keeper) is just a convenience — the
first caller of a permissionless `settle` instruction that anyone could call with the same
public proof.

## The settlement pipeline, end to end

1. **Finalisation.** TxLINE's scores stream emits the finalised record for a fixture
   (`action=game_finalised`, `statusId=100`, `period=100`). It covers regulation wins,
   extra time, penalties and abandonment — one uniform terminal record.
2. **Proof fetch.** The keeper requests
   `GET /api/scores/stat-validation?fixtureId=…&seq=<finalSeq>&statKeys=1,2`
   (keys 7,8 for corners markets). The response contains the stat leaves, per-stat Merkle
   proofs, the fixture sub-tree proof, and the main-tree proof up to the daily root.
3. **On-chain verification.** The keeper calls `finalwhistle::settle(winning_outcome, payload)`.
   The program:
   - checks `payload.fixture_summary.fixture_id == market.fixture_id`;
   - checks the payload contains exactly the market's settlement stat keys with `period == 100`;
   - derives the canonical TxLINE PDA `["daily_scores_roots", epoch_day_le_u16]` from
     `payload.ts` and requires the passed roots account to match — an attacker cannot
     substitute their own roots account;
   - **constructs the predicate itself** from `(market.kind, market.line, winning_outcome)`:

     | Market | Outcome | Predicate proven on-chain |
     |---|---|---|
     | Winner | Home | `stat[home_goals] − stat[away_goals] > 0` |
     | Winner | Draw | `… = 0` |
     | Winner | Away | `… < 0` |
     | Totals (line N.5) | Over | `stat[home] + stat[away] > N` |
     | Totals (line N.5) | Under | `stat[home] + stat[away] < N + 1` |

   - CPIs into `txoracle::validate_stat_v2(payload, strategy)` and requires the returned
     boolean to be `true`. The TxLINE program recomputes the Merkle chain
     `stat leaf → event-stat root → fixture sub-tree → main tree → anchored daily root`
     and evaluates the predicate on the proven values.
4. **Payouts.** The market flips to `Settled`; `claim` pays each winning position
   `stake × total_pool / winning_pool` (u128 floor math — the vault can never be overdrawn)
   straight from the vault PDA via a system transfer signed with program seeds.

### Threat model

| Attack | Defence |
|---|---|
| Keeper claims the wrong outcome | predicate is derived from the claimed outcome; the CPI fails because the Merkle-proven stats refute it |
| Forged/edited proof payload | Merkle recomputation inside `txoracle` fails against the anchored root |
| Proof from an in-play record ("home was leading at HT") | program requires `period == 100` finalised stats |
| Proof from another fixture | fixture id equality gate |
| Fake roots account | PDA re-derivation against the txoracle program id |
| Settle before kickoff / double settle | market state machine (`Open → Settled/Void`, single transition) |
| Fixture cancelled, no proof possible | `void_expired` after a 5-day window → full refunds |
| Winning pool empty | market voids instead of settling → losers reclaim stakes |
| Vault drained by rounding | floor division; sum of payouts ≤ pool |

### Why parimutuel

Parimutuel pools need no counterparty, no order book and no liquidity provider — ideal for a
market that must *always* be resolvable purely from a final score. Implied odds are just
`total / pool_i`, shown live in the UI as pool shares shift.

## Program (Anchor 0.31, `program/`)

Accounts:

- `Market` — fixture id, kind (`Winner | TotalGoals | TotalCorners`), half-line, nonce,
  kickoff ts, state, pools `[u64;3]`, bumps. PDA: `["market", fixture_id, kind, line, nonce]`.
- `Position` — per (market, bettor, outcome), amount. Closed on claim (rent back to bettor).
- Vault — a data-less `SystemAccount` PDA `["vault", market]`; funds move only by
  system-program transfers (in: user signature; out: program-signed with seeds).

The TxLINE program is integrated with Anchor's `declare_program!(txoracle)` against the
published devnet IDL — no hand-rolled discriminators, and the CPI types
(`StatValidationInput`, `NDimensionalStrategy`, …) come straight from the IDL.

Instructions: `create_market`, `place_bet`, `settle`, `claim`, `void_expired`.
All money paths are covered by overflow checks (`overflow-checks = true` in release profile).

## Keeper / API (`server/`)

- **Auth:** guest JWT with automatic renewal on 401; long-lived `X-Api-Token` from the
  devnet free-tier subscription (`scripts/setup-devnet.mjs` does wallet → ATA →
  `subscribe(1, 4)` → sign `${txSig}::${jwt}` → `/api/token/activate`).
- **Fixtures sync** (5 min): `/api/fixtures/snapshot` → upcoming covered fixtures →
  `create_market` for 1X2 and O/U 2.5 (idempotent; PDA existence check).
- **Scores SSE:** normalises records (PascalCase/camelCase tolerant), maintains per-fixture
  live state + event log, relays to browsers over `/api/stream` (our own SSE fan-out), and
  fires the settlement pipeline on finalisation. Reconnects with exponential backoff.
- **Odds SSE:** latest consensus prices + in-memory history for the price-movement chart.
- **Demo replay:** `/api/demo/start?fixtureId=…` re-broadcasts `/api/scores/historical/{id}`
  records at configurable speed and finishes with a **real** on-chain settlement using the
  **real** proof — pacing is the only simulated thing. Built because judging happens after
  the tournament ends (as the brief anticipates).

## Web (`web/`)

React + Vite + Tailwind. Wallet adapter (Phantom/Solflare) on devnet.

- Live match grid and match pages fed by the SSE relay.
- Market cards: pool-share probability bars, live parimutuel odds, one-click betting.
- Consensus odds panel: implied probabilities (vig removed) + price-movement chart
  (hand-rolled SVG, colorblind-validated palette).
- **Receipt page** (`/receipt/:market`): the full settlement evidence chain and a
  **browser-side re-verification** — the page rebuilds the exact `validate_stat_v2` call
  from the stored proof and runs it as a read-only simulation against devnet RPC using a
  throwaway keypair. The verdict comes from the TxLINE program itself, not from our backend.

## Determinism notes

- The strategy/predicate builder is a pure function of `(kind, line, outcome)` — identical
  in Rust (`build_strategy`) and mirrored in TS only for display (`describeStrategy`).
- Epoch day is always derived from the proof's own `minTimestamp` (never wall clock).
- Half-lines eliminate pushes: `line = N` ⇔ over/under N.5, so exactly one side wins.

## Known limitations / future work

- SOL stakes (devnet). USDC-SPL vaults are a mechanical extension (same PDA escrow pattern).
- Corners markets are implemented in the program; the keeper currently opens 1X2 + totals
  by default to keep pools concentrated.
- Odds history is in-memory (bounded); a real deployment would persist it.
- One keeper today, but any number can run in parallel — settlement is first-proof-wins.
