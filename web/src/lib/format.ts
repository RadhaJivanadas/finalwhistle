export const SOL = 1_000_000_000;

export function fmtSol(lamports: string | number | bigint, digits = 3): string {
  return `${(Number(lamports) / SOL).toLocaleString("en-US", { maximumFractionDigits: digits })} SOL`;
}

export function fmtTime(ts: number): string {
  return new Date(ts).toLocaleString("en-GB", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

export function shortAddr(addr: string, n = 4): string {
  return `${addr.slice(0, n)}…${addr.slice(-n)}`;
}

export function explorerTx(sig: string): string {
  return `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
}

export function explorerAddr(addr: string): string {
  return `https://explorer.solana.com/address/${addr}?cluster=devnet`;
}

/** Parimutuel implied decimal odds for an outcome: total / pool_i (no vig). */
export function impliedOdds(pools: string[], i: number): number | null {
  const total = pools.reduce((a, p) => a + Number(p), 0);
  const pool = Number(pools[i]);
  if (!total || !pool) return null;
  return total / pool;
}

/** Implied probability from parimutuel pools. */
export function impliedProb(pools: string[], i: number): number | null {
  const total = pools.reduce((a, p) => a + Number(p), 0);
  if (!total) return null;
  return Number(pools[i]) / total;
}

/** Implied probabilities from bookmaker decimal prices (normalised, vig removed). */
export function pricesToProbs(prices: number[]): number[] {
  // TxLINE StablePrice prices arrive as integers scaled by 1000 (e.g. 2500 = 2.5).
  const dec = prices.map((p) => (p > 100 ? p / 1000 : p));
  const inv = dec.map((d) => (d > 0 ? 1 / d : 0));
  const s = inv.reduce((a, b) => a + b, 0);
  return s ? inv.map((v) => v / s) : inv;
}
