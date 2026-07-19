# Superteam Earn submission — form answers

**Link to Your Submission** (primary link)

https://finalwhistle-1sck.onrender.com

**Project Title**

Final Whistle — Trustless World Cup Prediction Markets Settled by TxLINE Merkle Proofs

**Briefly explain your Project**

Final Whistle is a parimutuel prediction market on Solana. A keeper reads TxLINE's fixtures
feed and opens markets for each covered match (1X2 and total goals). People stake SOL. The UI
streams live scores, match events and consensus odds over SSE.

The part we care about most is settlement, because nobody on our team can decide who won.
When TxLINE publishes a match's game_finalised record, anyone can hand our escrow the Merkle
proof of the final score. The program checks four things before money moves: the proof belongs
to this fixture; the stats are the finalised ones (period 100), not half-time; the roots
account matches the canonical TxLINE PDA, re-derived on-chain; and the outcome predicate,
which the program builds itself, has to verify via CPI into validate_stat_v2. Claim the wrong
winner and the proof refutes you. If a match is never finalised at all, a time-locked void
path refunds every stake.

Each settled market gets a public receipt page with a "Verify in my browser" button that
re-runs the same on-chain check as a read-only simulation. The verdict comes from the TxLINE
program, not our backend.

This ran against the real tournament. We settled England 1–2 Argentina (fixture 18241006) on
devnet; the settle transaction is de1azpUT...f5Abdv on Solana Explorer. Stakes are native SOL.
The TxLINE credit token only authorizes the data subscription, per the track's asset rules.

**Link to your live & working MVP**

https://finalwhistle-1sck.onrender.com

**Link to Your Live Demo Video**

https://www.youtube.com/watch?v=8FjUaNCVtjA

**Project's Public Repository Link**

https://github.com/RadhaJivanadas/finalwhistle

**Link to your Project's Technical Documentation**

https://github.com/RadhaJivanadas/finalwhistle/blob/main/docs/TECHNICAL.md

**Share your team's experience using the TxLINE API**

What we liked most. validate_stat_v2 taking a generic payload plus an N-dimensional strategy
meant our escrow could express every market we wanted (1X2 via subtract/compare, totals via
add/compare) with one CPI and zero custom hashing on our side. The published Anchor IDL worked
with declare_program! on the first try, so the integration felt like a first-party SDK rather
than scraping an API. And game_finalised is exactly what a settlement engine needs: one
terminal record (statusId=100, period=100) that covers full time, extra time, penalties and
abandonment, so we got a single deterministic trigger with no tournament edge cases.

Where we hit friction. Devnet SOL was the slowest step of onboarding: the public dispenser
rate-limits hard, so "time to first API call" was mostly us hunting SOL for the subscribe
transaction. Proof field encodings took trial and error (eventStatRoot arrives as base64 while
the docs also anticipate hex and arrays; seq appears as both Seq and seq depending on the
endpoint), which cost us an hour of InvalidMainTreeProof debugging that a published JSON
Schema would have saved. The period=100 finality rule is documented but spread across three
pages; a single "how to settle a market correctly" recipe would be a killer doc. The compute
needs of validate_stat_v2 are opaque, so we budget 1.4M CU because the examples do.
/api/scores/historical returns SSE-formatted text over a plain GET, unlike its JSON siblings.
And one thing we only learned from a live match: the finalised record's Merkle proof anchors a
few minutes after the whistle, while the feed goes quiet. Our keeper now retries every 90
seconds until the proof lands.

Net: this is the fastest path from sports data to money moving trustlessly on-chain that
we've seen. Our complaints are documentation-shaped, not architecture-shaped.

**Anything Else?**

Proof this works, on Solana devnet (all finalized). England 1–2 Argentina, fixture 18241006:

- Settle winner (away win):
  https://explorer.solana.com/tx/de1azpUTtdxuAjZxHX8QT13DxJ6Z7nYthAUcb5wAQi9sfw4U5S43D5twkFRWamkqqXRkSndJjYdtbNyNyf5Abdv?cluster=devnet
- Settle totals (over 2.5):
  https://explorer.solana.com/tx/3WKM774wNPrcHD55AscivVLrKtctqQD1iRjHFoGsfrq9mWYCQTWq3hbMvyigycZrYDFTwprSM7mYLeSXChDMGrGm?cluster=devnet
- Program: 3pqHn5WcqLpHRcZDP6FKTSez7VmjeDDzzuxb72FUoB3P (devnet)

For testing: settled-market receipts are live on the site. Open any receipt and press
"Verify in my browser"; the page re-runs validate_stat_v2 as a read-only simulation against
devnet RPC, so you get the verdict from the TxLINE program, not from us. Matches end before
review, so the server also has a replay mode that re-broadcasts a finished fixture's real
TxLINE records and then performs a real on-chain settlement with the real proof. Only the
pacing is simulated.

The keeper has no special authority. settle is permissionless and first-proof-wins, so anyone
can run one.

TxLINE endpoints used: /auth/guest/start; on-chain subscribe + /api/token/activate;
/api/fixtures/snapshot; /api/scores/stream (SSE); /api/odds/stream (SSE); /api/scores/snapshot
and /api/scores/historical; /api/scores/stat-validation; on-chain txoracle.validate_stat_v2
(CPI + browser simulation).
