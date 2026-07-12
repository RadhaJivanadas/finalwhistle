/**
 * Browser-side Solana layer.
 *
 * Betting/claiming runs through the connected wallet. Proof re-verification
 * needs no wallet at all: we simulate TxLINE's `validateStatV2` view against
 * devnet, so any visitor can independently check a settlement's Merkle proof.
 */
import { AnchorProvider, BN, Program } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, ComputeBudgetProgram, SystemProgram } from "@solana/web3.js";
import type { AnchorWallet } from "@solana/wallet-adapter-react";
import finalwhistleIdl from "../idl/finalwhistle.json";
import txoracleIdl from "../idl/txoracle.json";
import type { SettlementReceipt } from "./types";

export const RPC_URL = (import.meta as any).env?.VITE_RPC_URL || "https://api.devnet.solana.com";
export const connection = new Connection(RPC_URL, "confirmed");

/** Read-only wallet stub for provider construction when no wallet is connected
 *  (Anchor's NodeWallet is not exported in browser builds). */
function readonlyWallet() {
  const kp = Keypair.generate();
  return {
    publicKey: kp.publicKey,
    signTransaction: async (tx: any) => tx,
    signAllTransactions: async (txs: any[]) => txs,
  };
}

const KIND_NUM: Record<string, number> = { winner: 0, totalGoals: 1, totalCorners: 2 };
const KIND_VARIANT: Record<string, object> = {
  winner: { winner: {} },
  totalGoals: { totalGoals: {} },
  totalCorners: { totalCorners: {} },
};

export function programFor(wallet: AnchorWallet | undefined) {
  const provider = new AnchorProvider(connection, (wallet ?? readonlyWallet()) as any, {
    commitment: "confirmed",
  });
  return new Program(finalwhistleIdl as any, provider);
}

export function marketPda(fixtureId: number, kind: string, line: number, nonce: number): PublicKey {
  const program = programFor(undefined);
  const fx = Buffer.alloc(8);
  fx.writeBigInt64LE(BigInt(fixtureId));
  const ln = Buffer.alloc(4);
  ln.writeInt32LE(line);
  const nc = Buffer.alloc(2);
  nc.writeUInt16LE(nonce);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("market"), fx, Buffer.from([KIND_NUM[kind]]), ln, nc],
    program.programId
  )[0];
}

export function vaultPda(market: PublicKey, programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("vault"), market.toBuffer()], programId)[0];
}

export function positionPda(
  market: PublicKey,
  bettor: PublicKey,
  outcome: number,
  programId: PublicKey
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("position"), market.toBuffer(), bettor.toBuffer(), Buffer.from([outcome])],
    programId
  )[0];
}

export async function placeBet(
  wallet: AnchorWallet,
  market: string,
  outcome: number,
  lamports: number
): Promise<string> {
  const program = programFor(wallet);
  const marketPk = new PublicKey(market);
  return (program.methods as any)
    .placeBet(outcome, new BN(lamports))
    .accounts({
      market: marketPk,
      vault: vaultPda(marketPk, program.programId),
      position: positionPda(marketPk, wallet.publicKey, outcome, program.programId),
      bettor: wallet.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
}

export async function claim(wallet: AnchorWallet, market: string, outcome: number): Promise<string> {
  const program = programFor(wallet);
  const marketPk = new PublicKey(market);
  return (program.methods as any)
    .claim()
    .accounts({
      market: marketPk,
      vault: vaultPda(marketPk, program.programId),
      position: positionPda(marketPk, wallet.publicKey, outcome, program.programId),
      bettor: wallet.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
}

export async function fetchPositions(wallet: AnchorWallet) {
  const program = programFor(wallet);
  const positions = await (program.account as any).position.all([
    { memcmp: { offset: 8 + 32, bytes: wallet.publicKey.toBase58() } },
  ]);
  return positions.map((p: any) => ({
    address: p.publicKey.toBase58(),
    market: p.account.market.toBase58(),
    outcome: p.account.outcome,
    amount: String(p.account.amount),
  }));
}

// ---------------------------------------------------------------------------
// Trustless re-verification in the browser
// ---------------------------------------------------------------------------

function toBytes32(value: string | number[]): number[] {
  const bytes = Array.isArray(value)
    ? Uint8Array.from(value)
    : value.startsWith("0x")
      ? Buffer.from(value.slice(2), "hex")
      : Buffer.from(value, "base64");
  if (bytes.length !== 32) throw new Error(`expected 32 bytes, got ${bytes.length}`);
  return Array.from(bytes);
}

const mapProof = (nodes: any[]) =>
  (nodes ?? []).map((n) => ({ hash: toBytes32(n.hash), isRightSibling: n.isRightSibling }));

/**
 * Re-runs the exact on-chain validation of a settlement receipt as a read-only
 * simulation from this browser: same proof, same predicate, same TxLINE
 * program, same daily Merkle-root account. Returns the oracle's boolean,
 * decoded from the program's return data.
 *
 * The transaction is never sent — `simulateTransaction` with sigVerify off.
 * Any existing account can serve as fee payer for a simulation; we use the
 * keeper's public key fetched from /api/health.
 */
export async function verifyReceiptInBrowser(receipt: SettlementReceipt): Promise<boolean> {
  const provider = new AnchorProvider(connection, readonlyWallet() as any, {
    commitment: "confirmed",
  });
  const txoracle = new Program(txoracleIdl as any, provider);
  const v = receipt.proof;

  const payload = {
    ts: new BN(v.summary.updateStats.minTimestamp),
    fixtureSummary: {
      fixtureId: new BN(v.summary.fixtureId),
      updateStats: {
        updateCount: v.summary.updateStats.updateCount,
        minTimestamp: new BN(v.summary.updateStats.minTimestamp),
        maxTimestamp: new BN(v.summary.updateStats.maxTimestamp),
      },
      eventsSubTreeRoot: toBytes32(v.summary.eventStatsSubTreeRoot),
    },
    fixtureProof: mapProof(v.subTreeProof),
    mainTreeProof: mapProof(v.mainTreeProof),
    eventStatRoot: toBytes32(v.eventStatRoot),
    stats: (v.statsToProve ?? []).map((stat: any, i: number) => ({
      stat: { key: stat.key, value: stat.value, period: stat.period },
      statProof: mapProof(v.statProofs[i]),
    })),
  };

  // Rebuild the strategy exactly as the settlement program did on-chain.
  const s = receipt.strategy.discretePredicates[0].binary;
  const strategy = {
    geometricTargets: [],
    distancePredicate: null,
    discretePredicates: [
      {
        binary: {
          indexA: s.indexA,
          indexB: s.indexB,
          op: s.op,
          predicate: s.predicate,
        },
      },
    ],
  };

  const epochDay = Math.floor(v.summary.updateStats.minTimestamp / 86_400_000);
  const [dailyScoresPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("daily_scores_roots"), new BN(epochDay).toArrayLike(Buffer, "le", 2)],
    txoracle.programId
  );

  const ix = await (txoracle.methods as any)
    .validateStatV2(payload, strategy)
    .accounts({ dailyScoresMerkleRoots: dailyScoresPda })
    .instruction();

  // Any funded account works as simulation fee payer; ask the API for one.
  const health = await (await fetch("/api/health")).json();
  const payer = new PublicKey(health.keeper);

  const { TransactionMessage, VersionedTransaction } = await import("@solana/web3.js");
  const msg = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: (await connection.getLatestBlockhash()).blockhash,
    instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }), ix],
  }).compileToV0Message();
  const tx = new VersionedTransaction(msg);

  const sim = await connection.simulateTransaction(tx, { sigVerify: false });
  if (sim.value.err) {
    throw new Error(`oracle simulation failed: ${JSON.stringify(sim.value.err)}`);
  }
  const ret = sim.value.returnData?.data?.[0];
  if (!ret) throw new Error("oracle returned no data");
  return Buffer.from(ret, "base64")[0] === 1;
}
