# Superteam Earn submission — form answers

> Fill the URLs after deploying publicly and recording the video.

**Project Title**

Final Whistle — trustless World Cup prediction markets settled by TxLINE Merkle proofs

**Briefly explain your Project**

Final Whistle is a parimutuel prediction market on Solana where settlement requires zero trust.
A keeper turns TxLINE's fixtures feed into on-chain markets (1X2, total goals) and streams live
scores/odds into the UI. When TxLINE emits a match's `game_finalised` record, anyone can submit
its Merkle proof to our escrow program, which CPIs into TxLINE's `validate_stat_v2` on-chain —
funds unlock only if TxODDS's anchored daily Merkle root cryptographically confirms the outcome.
Every settled market gets a public receipt page where any visitor can re-run the exact on-chain
verification from their own browser. No oracle committee, no admin key, no way for us (or a
malicious keeper) to pick winners: wrong outcomes are refuted by the proof itself, and a
time-locked void path guarantees refunds if a fixture is never finalised.

**Link to your live & working MVP**

https://finalwhistle-1sck.onrender.com

**Link to Your Live Demo Video**

`<loom/youtube url>`

**Project's Public Repository Link**

`https://github.com/RadhaJivanadas/finalwhistle`

**Link to your Project's Technical Documentation**

`https://github.com/RadhaJivanadas/finalwhistle/blob/main/docs/TECHNICAL.md`

**On-chain proof (real match, Solana devnet)**

England 1–2 Argentina (fixture 18241006), settled via CPI into `validate_stat_v2`:
- Settle winner: `de1azpUTtdxuAjZxHX8QT13DxJ6Z7nYthAUcb5wAQi9sfw4U5S43D5twkFRWamkqqXRkSndJjYdtbNyNyf5Abdv`
- Settle totals: `3WKM774wNPrcHD55AscivVLrKtctqQD1iRjHFoGsfrq9mWYCQTWq3hbMvyigycZrYDFTwprSM7mYLeSXChDMGrGm`
- All on `explorer.solana.com/tx/<sig>?cluster=devnet`

**Asset & compliance note**

Stakes and payouts are in native SOL. The TxLINE credit token is used only to authorize the
data subscription — never for staking, wagering pools, or peer-to-peer transfers. Settlement
unlocks and routes coins other than TxLINE, in line with the track's asset rules.

**Share your team's experience using the TxLINE API**

See docs/FEEDBACK.md — paste its contents here (fits the "liked most / friction" prompt).
