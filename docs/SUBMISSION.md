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

`<loom/youtube url>` (script: docs/DEMO_SCRIPT.md)

**Project's Public Repository Link**

`https://github.com/kovyrus/finalwhistle`

**Link to your Project's Technical Documentation**

`https://github.com/kovyrus/finalwhistle/blob/main/docs/TECHNICAL.md`

**Share your team's experience using the TxLINE API**

See docs/FEEDBACK.md — paste its contents here (fits the "liked most / friction" prompt).
