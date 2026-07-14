// Manually settle all open markets of a fixture once its finalised-record
// proof is anchored (retries until /api/scores/stat-validation stops 404ing).
//   node scripts/settle-fixture.mjs <fixtureId> <finalSeq>
import anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, ComputeBudgetProgram } from "@solana/web3.js";
import axios from "axios";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const { AnchorProvider, Program, Wallet, BN } = anchor;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const [fixtureId, finalSeq] = [Number(process.argv[2]), Number(process.argv[3])];
if (!fixtureId || !finalSeq) { console.error("usage: settle-fixture.mjs <fixtureId> <finalSeq>"); process.exit(1); }

const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, ".env.devnet"), "utf8")
  .split("\n").filter((l) => l.includes("=")).map((l) => l.split(/=(.*)/s).slice(0, 2)));

const toBytes32 = (v) => {
  const b = Array.isArray(v) ? Uint8Array.from(v) : v.startsWith?.("0x") ? Buffer.from(v.slice(2), "hex") : Buffer.from(v, "base64");
  if (b.length !== 32) throw new Error("bad bytes32");
  return Array.from(b);
};
const nodes = (ns) => (ns ?? []).map((n) => ({ hash: toBytes32(n.hash), isRightSibling: n.isRightSibling }));

const jwt = (await axios.post(`${env.TXLINE_API_HOST}/auth/guest/start`)).data.token;
const headers = { Authorization: `Bearer ${jwt}`, "X-Api-Token": env.TXLINE_API_TOKEN };

async function fetchProof(statKeys) {
  for (let i = 1; i <= 120; i++) {
    try {
      const r = await axios.get(`${env.TXLINE_API_HOST}/api/scores/stat-validation`,
        { headers, params: { fixtureId, seq: finalSeq, statKeys: statKeys.join(",") } });
      return r.data;
    } catch (e) {
      const code = e.response?.status;
      console.log(`proof ${statKeys}: attempt ${i} -> ${code ?? e.message}; waiting 15s`);
      await new Promise((s) => setTimeout(s, 15000));
    }
  }
  throw new Error("proof never became available");
}

const connection = new Connection(env.RPC_URL, "confirmed");
const keeper = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(path.join(ROOT, ".keys/keeper.json"), "utf8"))));
const provider = new AnchorProvider(connection, new Wallet(keeper), { commitment: "confirmed" });
const program = new Program(JSON.parse(fs.readFileSync(path.join(ROOT, "server/idl/finalwhistle.json"), "utf8")), provider);
const txoracleId = new PublicKey(env.TXORACLE_PROGRAM_ID);

const all = await program.account.market.all();
const open = all.filter((a) => Number(a.account.fixtureId) === fixtureId && Object.keys(a.account.state)[0] === "open");
console.log(`open markets for ${fixtureId}: ${open.length}`);

for (const m of open) {
  const kind = Object.keys(m.account.kind)[0];
  const statKeys = kind === "totalCorners" ? [7, 8] : [1, 2];
  const v = await fetchProof(statKeys);
  const [home, away] = v.statsToProve.map((s) => s.value);
  let outcome;
  if (kind === "winner") outcome = home > away ? 0 : home === away ? 1 : 2;
  else outcome = home + away > m.account.line ? 0 : 1;
  console.log(`${kind}: stats ${home}:${away} -> outcome ${outcome}`);

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
    fixtureProof: nodes(v.subTreeProof),
    mainTreeProof: nodes(v.mainTreeProof),
    eventStatRoot: toBytes32(v.eventStatRoot),
    stats: v.statsToProve.map((s, i) => ({ stat: { key: s.key, value: s.value, period: s.period }, statProof: nodes(v.statProofs[i]) })),
  };
  const epochDay = Math.floor(v.summary.updateStats.minTimestamp / 86400000);
  const [rootsPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("daily_scores_roots"), new BN(epochDay).toArrayLike(Buffer, "le", 2)], txoracleId);

  for (let a = 1; a <= 5; a++) {
    try {
      const sig = await program.methods.settle(outcome, payload)
        .accounts({ market: m.publicKey, dailyScoresMerkleRoots: rootsPda, txoracleProgram: txoracleId })
        .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 })])
        .rpc();
      console.log(`SETTLED ${kind} ${m.publicKey.toBase58()} tx=${sig}`);
      break;
    } catch (e) {
      console.log(`settle attempt ${a}: ${String(e.message).slice(0, 120)}`);
      if (String(e.message).includes("MarketNotOpen")) break; // another keeper won
      await new Promise((s) => setTimeout(s, 8000));
    }
  }
}
console.log("done");
