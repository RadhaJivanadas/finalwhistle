// Standalone proof check against the REAL devnet txoracle program:
// fetches the Merkle proof of a finalised record and asks validate_stat_v2
// (read-only .view() simulation) to verify the winner predicate.
//
//   node scripts/verify-proof.mjs <fixtureId> <finalSeq>
import anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, ComputeBudgetProgram } from "@solana/web3.js";
import axios from "axios";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const { AnchorProvider, Program, Wallet, BN } = anchor;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const env = Object.fromEntries(
  fs.readFileSync(path.join(ROOT, ".env.devnet"), "utf8")
    .split("\n").filter((l) => l.includes("=")).map((l) => l.split(/=(.*)/s).slice(0, 2))
);

const fixtureId = Number(process.argv[2]);
const seq = Number(process.argv[3]);
if (!fixtureId || !seq) {
  console.error("usage: node scripts/verify-proof.mjs <fixtureId> <finalSeq>");
  process.exit(1);
}

const toBytes32 = (v) => {
  const bytes = Array.isArray(v) ? Uint8Array.from(v)
    : typeof v === "string" && v.startsWith("0x") ? Buffer.from(v.slice(2), "hex")
    : Buffer.from(v, "base64");
  if (bytes.length !== 32) throw new Error(`expected 32 bytes, got ${bytes.length}`);
  return Array.from(bytes);
};
const toProofNodes = (nodes) => (nodes ?? []).map((n) => ({ hash: toBytes32(n.hash), isRightSibling: n.isRightSibling }));

const jwt = (await axios.post(`${env.TXLINE_API_HOST}/auth/guest/start`)).data.token;
const v = (await axios.get(`${env.TXLINE_API_HOST}/api/scores/stat-validation`, {
  headers: { Authorization: `Bearer ${jwt}`, "X-Api-Token": env.TXLINE_API_TOKEN },
  params: { fixtureId, seq, statKeys: "1,2" },
})).data;

const [home, away] = v.statsToProve.map((s) => s.value);
console.log(`fixture ${fixtureId} finalised: ${home}:${away} (periods ${v.statsToProve.map((s) => s.period)})`);

const connection = new Connection(env.RPC_URL, "confirmed");
const keeper = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(path.join(ROOT, ".keys/keeper.json"), "utf8"))));
const provider = new AnchorProvider(connection, new Wallet(keeper), { commitment: "confirmed" });
const txoracle = new Program(JSON.parse(fs.readFileSync(path.join(ROOT, "server/idl/txoracle.json"), "utf8")), provider);

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
  fixtureProof: toProofNodes(v.subTreeProof),
  mainTreeProof: toProofNodes(v.mainTreeProof),
  eventStatRoot: toBytes32(v.eventStatRoot),
  stats: v.statsToProve.map((stat, i) => ({
    stat: { key: stat.key, value: stat.value, period: stat.period },
    statProof: toProofNodes(v.statProofs[i]),
  })),
};

const comparison = home > away ? { greaterThan: {} } : home === away ? { equalTo: {} } : { lessThan: {} };
const strategy = {
  geometricTargets: [],
  distancePredicate: null,
  discretePredicates: [
    { binary: { indexA: 0, indexB: 1, op: { subtract: {} }, predicate: { threshold: 0, comparison } } },
  ],
};

const epochDay = Math.floor(v.summary.updateStats.minTimestamp / 86400000);
const [dailyScoresPda] = PublicKey.findProgramAddressSync(
  [Buffer.from("daily_scores_roots"), new BN(epochDay).toArrayLike(Buffer, "le", 2)],
  txoracle.programId
);
console.log(`daily_scores_roots PDA (epoch day ${epochDay}):`, dailyScoresPda.toBase58());

const ok = await txoracle.methods
  .validateStatV2(payload, strategy)
  .accounts({ dailyScoresMerkleRoots: dailyScoresPda })
  .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 })])
  .view();

console.log(`\nvalidate_stat_v2 (real devnet txoracle) returned: ${ok}`);
process.exit(ok ? 0 : 1);
