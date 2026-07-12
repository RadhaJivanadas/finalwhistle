/**
 * Solana layer: wraps the Final Whistle program (market lifecycle) and the
 * TxLINE txoracle program (proof validation) with one keeper wallet.
 */
import anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, ComputeBudgetProgram, SystemProgram } from "@solana/web3.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";

const { AnchorProvider, Program, Wallet, BN } = anchor;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const connection = new Connection(config.rpcUrl, "confirmed");

export const keeper = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(fs.readFileSync(config.keeperKeypair, "utf8")))
);

const provider = new AnchorProvider(connection, new Wallet(keeper), {
  commitment: "confirmed",
});

function loadIdl(name: string) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, "..", "idl", `${name}.json`), "utf8"));
}

export const finalwhistle = new Program(loadIdl("finalwhistle"), provider);
export const txoracle = new Program(loadIdl("txoracle"), provider);

export const MarketKind = { Winner: 0, TotalGoals: 1, TotalCorners: 2 } as const;
export type MarketKindName = keyof typeof MarketKind;

const KIND_VARIANT: Record<number, object> = {
  0: { winner: {} },
  1: { totalGoals: {} },
  2: { totalCorners: {} },
};

export function marketPda(fixtureId: number, kind: number, line: number, nonce = 0): PublicKey {
  const fx = Buffer.alloc(8);
  fx.writeBigInt64LE(BigInt(fixtureId));
  const ln = Buffer.alloc(4);
  ln.writeInt32LE(line);
  const nc = Buffer.alloc(2);
  nc.writeUInt16LE(nonce);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("market"), fx, Buffer.from([kind]), ln, nc],
    finalwhistle.programId
  )[0];
}

export function vaultPda(market: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), market.toBuffer()],
    finalwhistle.programId
  )[0];
}

export function dailyScoresPda(tsMs: number): { pda: PublicKey; epochDay: number } {
  const epochDay = Math.floor(tsMs / 86_400_000);
  return {
    pda: PublicKey.findProgramAddressSync(
      [Buffer.from("daily_scores_roots"), new BN(epochDay).toArrayLike(Buffer, "le", 2)],
      txoracle.programId
    )[0],
    epochDay,
  };
}

export async function createMarket(
  fixtureId: number,
  kind: number,
  line: number,
  kickoffTs: number, // seconds
  nonce = 0
): Promise<{ market: PublicKey; signature: string } | null> {
  const market = marketPda(fixtureId, kind, line, nonce);
  const existing = await connection.getAccountInfo(market);
  if (existing) return null; // already created

  const signature = await (finalwhistle.methods as any)
    .createMarket(new BN(fixtureId), KIND_VARIANT[kind], line, nonce, new BN(kickoffTs))
    .accounts({
      market,
      vault: vaultPda(market),
      creator: keeper.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
  return { market, signature };
}

// ---------------------------------------------------------------------------
// Proof plumbing (mirrors the TxLINE docs' toBytes32 / toProofNodes helpers)
// ---------------------------------------------------------------------------

export function toBytes32(value: string | number[] | Uint8Array): number[] {
  const bytes = Array.isArray(value)
    ? Uint8Array.from(value)
    : value instanceof Uint8Array
      ? value
      : value.startsWith("0x")
        ? Buffer.from(value.slice(2), "hex")
        : Buffer.from(value, "base64");
  if (bytes.length !== 32) throw new Error(`Expected 32 bytes, received ${bytes.length}`);
  return Array.from(bytes);
}

export function toProofNodes(nodes: Array<{ hash: any; isRightSibling: boolean }>) {
  return (nodes ?? []).map((n) => ({
    hash: toBytes32(n.hash),
    isRightSibling: n.isRightSibling,
  }));
}

/** Convert a /api/scores/stat-validation (statKeys=...) response into the
 *  on-chain `StatValidationInput` struct. */
export function buildPayload(validation: any) {
  return {
    ts: new BN(validation.summary.updateStats.minTimestamp),
    fixtureSummary: {
      fixtureId: new BN(validation.summary.fixtureId),
      updateStats: {
        updateCount: validation.summary.updateStats.updateCount,
        minTimestamp: new BN(validation.summary.updateStats.minTimestamp),
        maxTimestamp: new BN(validation.summary.updateStats.maxTimestamp),
      },
      eventsSubTreeRoot: toBytes32(validation.summary.eventStatsSubTreeRoot),
    },
    fixtureProof: toProofNodes(validation.subTreeProof),
    mainTreeProof: toProofNodes(validation.mainTreeProof),
    eventStatRoot: toBytes32(validation.eventStatRoot),
    stats: (validation.statsToProve ?? []).map((stat: any, i: number) => ({
      stat: { key: stat.key, value: stat.value, period: stat.period },
      statProof: toProofNodes(validation.statProofs[i]),
    })),
  };
}

/** The exact predicate the program will reconstruct on-chain — kept here only
 *  for the receipt UI so users can see what was proven. */
export function describeStrategy(kind: number, line: number, outcome: number) {
  if (kind === MarketKind.Winner) {
    const cmp = ["greaterThan", "equalTo", "lessThan"][outcome];
    return {
      discretePredicates: [
        { binary: { indexA: 0, indexB: 1, op: { subtract: {} }, predicate: { threshold: 0, comparison: { [cmp]: {} } } } },
      ],
    };
  }
  const threshold = outcome === 0 ? line : line + 1;
  const cmp = outcome === 0 ? "greaterThan" : "lessThan";
  return {
    discretePredicates: [
      { binary: { indexA: 0, indexB: 1, op: { add: {} }, predicate: { threshold, comparison: { [cmp]: {} } } } },
    ],
  };
}

export async function settleMarket(
  market: string | PublicKey,
  winningOutcome: number,
  validation: any
): Promise<string> {
  const payload = buildPayload(validation);
  const { pda } = dailyScoresPda(validation.summary.updateStats.minTimestamp);

  return (finalwhistle.methods as any)
    .settle(winningOutcome, payload)
    .accounts({
      market: new PublicKey(market),
      dailyScoresMerkleRoots: pda,
      txoracleProgram: txoracle.programId,
    })
    .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 })])
    .rpc();
}

export async function fetchAllMarkets(): Promise<any[]> {
  const accounts = await (finalwhistle.account as any).market.all();
  return accounts.map((a: any) => ({
    address: a.publicKey.toBase58(),
    fixtureId: Number(a.account.fixtureId),
    kind: Object.keys(a.account.kind)[0],
    line: a.account.line,
    nonce: a.account.nonce,
    kickoffTs: Number(a.account.kickoffTs),
    state: Object.keys(a.account.state)[0],
    winningOutcome: a.account.winningOutcome,
    pools: a.account.pools.map((p: any) => String(p)),
    settledTs: Number(a.account.settledTs),
  }));
}
