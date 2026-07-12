# Our TxLINE API experience

*(submission form: "What did you like the most, and where did you hit friction?")*

## What we liked most

- **The validation primitive is genuinely composable.** `validate_stat_v2` taking a generic
  payload + an N-dimensional strategy meant our escrow could express *every* market we wanted
  (1X2 via subtract/compare, totals via add/compare) with one CPI and zero custom hashing on
  our side. Building a trustless settlement engine on top took a single instruction.
- **One normalised schema, two networks.** Identical shapes on devnet and mainnet, and the
  published Anchor IDL (`declare_program!` just worked) made the integration feel like using
  a first-party SDK rather than scraping an API.
- **`game_finalised` semantics are exactly what a settlement engine needs.** One terminal
  record (`statusId=100`, `period=100`) covering FT/AET/pens/abandonment gave us a single
  deterministic trigger — no special-casing tournament edge cases.
- **SSE streams are clean and fast.** Standard SSE + heartbeats, easy to parse with ~40 lines
  of code, reconnect-friendly. `/api/scores/historical` made our replay demo (and disaster
  recovery) trivial.
- **Free-tier activation flow is a nice pattern.** On-chain subscribe + signed
  `${txSig}::${jwt}` activation is a neat proof-of-wallet design, and the runnable devnet
  examples repo made it reproducible in minutes.

## Where we hit friction

- **Devnet SOL is the real onboarding gate.** The public devnet faucet rate-limits
  aggressively, so "time to first API call" was dominated by hunting SOL for the `subscribe`
  transaction, not by TxLINE itself. A hackathon faucet for the subscription fee (or a
  signed-message-only free-tier activation that skips the on-chain tx) would remove the
  slowest step.
- **Proof field encodings take trial and error.** `eventStatRoot` / proof hashes arrive as
  base64 while the docs' `toBytes32` also anticipates hex and arrays; and the record `seq`
  appears as both `Seq` and `seq` depending on the endpoint. Publishing a JSON Schema (or
  TS types package) for `stat-validation` responses would have saved our first hour of
  `InvalidMainTreeProof` debugging.
- **Stat `period` vs record `statusId` semantics needed digging.** That the finalised
  record's stats carry `period=100` (and that this is the correct finality gate for
  settlement) is documented, but spread across three pages. A dedicated "how to settle a
  market correctly" recipe — record choice, phase table, pitfalls — would be a killer doc
  page for this exact use case.
- **`validateStatV2` compute needs are opaque.** We budget 1.4M CU because the examples do;
  actual usage varies with proof depth. Publishing typical/worst-case CU per proof shape
  would let integrators set tighter budgets (matters once settlement txs carry more
  instructions).
- **Minor:** `/api/scores/stat-validation` with `seq=0` fails with a generic error rather
  than "sequence must be ≥ 1"; and odds `Prices` scaling (×1000 integers) is easy to miss
  on first read.

Net: the fastest path from "sports data" to "money moving trustlessly on-chain" we've seen.
The friction list is all documentation-shaped, not architecture-shaped.
