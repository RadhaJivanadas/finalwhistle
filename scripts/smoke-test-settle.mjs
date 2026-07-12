// Settlement + claim smoke test against a local validator where a mock
// txoracle (always returns true) is loaded at the real txoracle address:
//
//   docker run … --bpf-program <finalwhistle> finalwhistle.so \
//                --bpf-program 6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J mock_oracle.so
//
// Verifies: CPI return-data handling, check gates, parimutuel payout math,
// double-claim protection, loser rejection.
import anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram, LAMPORTS_PER_SOL, ComputeBudgetProgram } from "@solana/web3.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const { AnchorProvider, Program, Wallet, BN } = anchor;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RPC = process.env.RPC_URL || "http://127.0.0.1:8899";

const connection = new Connection(RPC, "confirmed");
const keeper = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(fs.readFileSync(path.join(ROOT, ".keys/keeper.json"), "utf8")))
);
const idl = JSON.parse(fs.readFileSync(path.join(ROOT, "server/idl/finalwhistle.json"), "utf8"));
const provider = new AnchorProvider(connection, new Wallet(keeper), { commitment: "confirmed" });
const program = new Program(idl, provider);
const TXORACLE = new PublicKey("6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J");

const FIXTURE = 99000002;
const NONCE = Math.floor(Math.random() * 60000);
const NOW = Date.now();

let failures = 0;
const check = (name, cond) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}`);
  if (!cond) failures++;
};

const fx = Buffer.alloc(8); fx.writeBigInt64LE(BigInt(FIXTURE));
const ln = Buffer.alloc(4); ln.writeInt32LE(0);
const nc = Buffer.alloc(2); nc.writeUInt16LE(NONCE);
const [market] = PublicKey.findProgramAddressSync(
  [Buffer.from("market"), fx, Buffer.from([0]), ln, nc], program.programId);
const [vault] = PublicKey.findProgramAddressSync(
  [Buffer.from("vault"), market.toBuffer()], program.programId);
const positionPda = (bettor, outcome) => PublicKey.findProgramAddressSync(
  [Buffer.from("position"), market.toBuffer(), bettor.toBuffer(), Buffer.from([outcome])],
  program.programId)[0];

const payload = (overrides = {}) => ({
  ts: new BN(NOW),
  fixtureSummary: {
    fixtureId: new BN(overrides.fixtureId ?? FIXTURE),
    updateStats: { updateCount: 5, minTimestamp: new BN(NOW), maxTimestamp: new BN(NOW) },
    eventsSubTreeRoot: Array(32).fill(0),
  },
  fixtureProof: [], mainTreeProof: [], eventStatRoot: Array(32).fill(0),
  stats: overrides.stats ?? [
    { stat: { key: 1, value: 2, period: 100 }, statProof: [] },
    { stat: { key: 2, value: 1, period: 100 }, statProof: [] },
  ],
});

const dailyRootsPda = () => PublicKey.findProgramAddressSync(
  [Buffer.from("daily_scores_roots"), new BN(Math.floor(NOW / 86400000)).toArrayLike(Buffer, "le", 2)],
  TXORACLE)[0];

const settle = (outcome, p, roots = dailyRootsPda()) =>
  program.methods.settle(outcome, p)
    .accounts({ market, dailyScoresMerkleRoots: roots, txoracleProgram: TXORACLE })
    .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 })])
    .rpc();

async function main() {
  console.log("market:", market.toBase58());
  const alice = Keypair.generate(); // will win (home)
  const bob = Keypair.generate();   // will lose (away)
  for (const kp of [alice, bob]) {
    const sig = await connection.requestAirdrop(kp.publicKey, 10 * LAMPORTS_PER_SOL);
    await connection.confirmTransaction(sig, "confirmed");
  }

  const kickoff = Math.floor(Date.now() / 1000) + 12;
  await program.methods
    .createMarket(new BN(FIXTURE), { winner: {} }, 0, NONCE, new BN(kickoff))
    .accounts({ market, vault, creator: keeper.publicKey, systemProgram: SystemProgram.programId })
    .rpc();

  const bet = (kp, outcome, sol) =>
    program.methods.placeBet(outcome, new BN(sol * LAMPORTS_PER_SOL))
      .accounts({
        market, vault, position: positionPda(kp.publicKey, outcome),
        bettor: kp.publicKey, systemProgram: SystemProgram.programId,
      }).signers([kp]).rpc();

  await bet(alice, 0, 2);
  await bet(bob, 2, 4);

  // Gate tests before valid settlement
  let rejected = false;
  try { await settle(0, payload({ fixtureId: FIXTURE + 1 })); } catch { rejected = true; }
  check("gate: wrong fixture id rejected", rejected);

  rejected = false;
  try {
    await settle(0, payload({ stats: [
      { stat: { key: 1, value: 2, period: 2 }, statProof: [] },
      { stat: { key: 2, value: 1, period: 2 }, statProof: [] },
    ] }));
  } catch { rejected = true; }
  check("gate: non-finalised record (period!=100) rejected", rejected);

  rejected = false;
  try { await settle(0, payload(), Keypair.generate().publicKey); } catch { rejected = true; }
  check("gate: non-canonical roots PDA rejected", rejected);

  // Valid settlement (mock oracle returns true): home wins
  const sig = await settle(0, payload());
  console.log("settle tx:", sig);
  let acc = await program.account.market.fetch(market);
  check("market settled, home outcome", Object.keys(acc.state)[0] === "settled" && acc.winningOutcome === 0);

  rejected = false;
  try { await settle(2, payload()); } catch { rejected = true; }
  check("double settlement rejected", rejected);

  // Claims: pool = 6 SOL, winning pool = 2 SOL -> alice gets 2*6/2 = 6 SOL
  const before = await connection.getBalance(alice.publicKey);
  await program.methods.claim().accounts({
    market, vault, position: positionPda(alice.publicKey, 0),
    bettor: alice.publicKey, systemProgram: SystemProgram.programId,
  }).signers([alice]).rpc();
  const after = await connection.getBalance(alice.publicKey);
  const delta = (after - before) / LAMPORTS_PER_SOL;
  check(`winner payout ≈ 6 SOL (got ${delta.toFixed(4)}, incl. rent refund)`, delta > 5.99 && delta < 6.01);

  rejected = false;
  try {
    await program.methods.claim().accounts({
      market, vault, position: positionPda(alice.publicKey, 0),
      bettor: alice.publicKey, systemProgram: SystemProgram.programId,
    }).signers([alice]).rpc();
  } catch { rejected = true; }
  check("double claim rejected (position closed)", rejected);

  rejected = false;
  try {
    await program.methods.claim().accounts({
      market, vault, position: positionPda(bob.publicKey, 2),
      bettor: bob.publicKey, systemProgram: SystemProgram.programId,
    }).signers([bob]).rpc();
  } catch { rejected = true; }
  check("loser claim rejected", rejected);

  console.log(failures ? `\n${failures} FAILURES` : "\nALL SETTLEMENT TESTS PASSED");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
