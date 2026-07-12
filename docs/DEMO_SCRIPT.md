# Demo video script (≤ 5 minutes)

> Screen-record at 1080p+. Have two browser windows ready: the app and Solana Explorer.
> Start the demo replay ~2 minutes before recording the settlement segment, or run it live
> during the betting window. Keep Phantom on devnet with a funded wallet.

## 0:00–0:35 — The problem (talking head or slides over the app hero)

- "Every prediction market has the same weak point: who decides the result? An admin key,
  a multisig, a committee vote. If they're wrong — or malicious — your money is gone."
- "Final Whistle removes that entirely. Markets settle themselves, on-chain, from
  **TxLINE's cryptographically signed World Cup data**. Let me show you."

## 0:35–1:30 — Live data (Home + Match page)

- Scroll the home grid: "Every fixture here comes from TxLINE's fixtures feed; our keeper
  automatically opened on-chain markets for each one."
- Open a live/replaying match: point at the score ticking, the event feed
  ("goals, cards, corners — this is TxLINE's scores SSE stream, relayed straight into the UI"),
  and the consensus odds panel ("implied probabilities from TxLINE StablePrice odds,
  updating live").

## 1:30–2:20 — Place bets (betting window of the demo replay)

- Connect Phantom. Pick the match-winner market: "Pools are parimutuel — my odds are just
  the pool ratio, no market maker needed."
- Place a bet on the known winner (e.g. Home), confirm in wallet, show the tx toast.
- Place a second bet from the other wallet on a losing outcome (optional, pre-recorded).
- Show "My bets" page with the open position.

## 2:20–3:40 — The whistle: trustless settlement (the money shot)

- Let the replay reach full time: "The referee blows the whistle — TxLINE emits the
  `game_finalised` record. Watch what happens with **zero human input**."
- Market card flips to **✓ Settled**: "Our keeper fetched the Merkle proof from TxLINE's
  stat-validation endpoint and called `settle`. The escrow program **did not trust the
  keeper** — it derived the predicate 'home goals minus away goals > 0', CPI'd into
  TxLINE's on-chain program `validate_stat_v2`, which re-computed the Merkle chain against
  the daily root TxODDS anchors on Solana. Only a `true` from that CPI unlocks the funds."
- Open the settlement tx in Solana Explorer: show the inner CPI to the txoracle program id.
- Go to "My bets" → **Claim winnings** → balance increases.

## 3:40–4:30 — The receipt: don't trust, verify

- Open the market's **Proof receipt** page. Walk the 4 steps: finalised record stats,
  the exact predicate, Merkle path sizes + root PDA link, settlement tx link.
- Click **"Verify in my browser"**: "This isn't our API answering — the browser just
  simulated `validate_stat_v2` against devnet with the same proof. The oracle itself says
  ✓ true. Anyone auditing a settlement can do this, forever."

## 4:30–5:00 — Wrap

- "Everything you saw is live on devnet: an Anchor escrow with permissionless,
  proof-gated settlement; a keeper that turns TxLINE's fixtures/scores/odds streams into
  markets; and receipts anyone can re-verify."
- "TxLINE data is the primary — and only — source of truth: fixtures, live scores, odds,
  and the Merkle proofs that move the money. Thanks for watching."

## Shot checklist

- [ ] Score updates visibly ticking (SSE)
- [ ] Wallet approval popup on `place_bet`
- [ ] Market card flipping to Settled without manual action
- [ ] Explorer view of settle tx showing CPI into `6pW64g…yP2J`
- [ ] Claim → wallet balance delta
- [ ] Receipt page + in-browser verification returning ✓
