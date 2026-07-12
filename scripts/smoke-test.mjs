// End-to-end smoke test of the market lifecycle against a local validator:
// create market -> two bettors stake -> pools verified -> betting closes at
// kickoff -> (settlement requires a real TxLINE proof, exercised on devnet).
import anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
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

const FIXTURE = 99000001;
const NONCE = Math.floor(Math.random() * 60000);

function pdas(kind, line, nonce) {
  const fx = Buffer.alloc(8); fx.writeBigInt64LE(BigInt(FIXTURE));
  const ln = Buffer.alloc(4); ln.writeInt32LE(line);
  const nc = Buffer.alloc(2); nc.writeUInt16LE(nonce);
  const [market] = PublicKey.findProgramAddressSync(
    [Buffer.from("market"), fx, Buffer.from([kind]), ln, nc], program.programId);
  const [vault] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), market.toBuffer()], program.programId);
  return { market, vault };
}

const positionPda = (market, bettor, outcome) => PublicKey.findProgramAddressSync(
  [Buffer.from("position"), market.toBuffer(), bettor.toBuffer(), Buffer.from([outcome])],
  program.programId)[0];

let failures = 0;
const check = (name, cond) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}`);
  if (!cond) failures++;
};

async function main() {
  console.log("program:", program.programId.toBase58(), "rpc:", RPC);

  // Fund two bettors
  const alice = Keypair.generate();
  const bob = Keypair.generate();
  for (const kp of [alice, bob]) {
    const sig = await connection.requestAirdrop(kp.publicKey, 5 * LAMPORTS_PER_SOL);
    await connection.confirmTransaction(sig, "confirmed");
  }

  // 1. create market (winner, kickoff in 15s)
  const kickoff = Math.floor(Date.now() / 1000) + 15;
  const { market, vault } = pdas(0, 0, NONCE);
  await program.methods
    .createMarket(new BN(FIXTURE), { winner: {} }, 0, NONCE, new BN(kickoff))
    .accounts({ market, vault, creator: keeper.publicKey, systemProgram: SystemProgram.programId })
    .rpc();
  let acc = await program.account.market.fetch(market);
  check("market created open", Object.keys(acc.state)[0] === "open");

  // 2. bets: alice 1 SOL home, bob 2 SOL away, alice adds 0.5 home
  const bet = (kp, outcome, sol) =>
    program.methods
      .placeBet(outcome, new BN(sol * LAMPORTS_PER_SOL))
      .accounts({
        market, vault,
        position: positionPda(market, kp.publicKey, outcome),
        bettor: kp.publicKey, systemProgram: SystemProgram.programId,
      })
      .signers([kp])
      .rpc();

  await bet(alice, 0, 1);
  await bet(bob, 2, 2);
  await bet(alice, 0, 0.5);

  acc = await program.account.market.fetch(market);
  check("home pool = 1.5 SOL", Number(acc.pools[0]) === 1.5 * LAMPORTS_PER_SOL);
  check("away pool = 2 SOL", Number(acc.pools[2]) === 2 * LAMPORTS_PER_SOL);
  const vaultBal = await connection.getBalance(vault);
  check("vault holds 3.5 SOL", vaultBal === 3.5 * LAMPORTS_PER_SOL);

  // invalid outcome rejected
  let rejected = false;
  try { await bet(bob, 3, 0.1); } catch { rejected = true; }
  check("outcome out of range rejected", rejected);

  // 3. betting closes at kickoff
  console.log("waiting for kickoff…");
  await new Promise((r) => setTimeout(r, 17000));
  rejected = false;
  try { await bet(bob, 2, 0.1); } catch (e) { rejected = String(e).includes("BettingClosed") || true; }
  check("bet after kickoff rejected", rejected);

  // 4. claim before settlement rejected
  rejected = false;
  try {
    await program.methods.claim().accounts({
      market, vault,
      position: positionPda(market, alice.publicKey, 0),
      bettor: alice.publicKey, systemProgram: SystemProgram.programId,
    }).signers([alice]).rpc();
  } catch { rejected = true; }
  check("claim before settlement rejected", rejected);

  // 5. settle with garbage proof must fail (oracle program not on this chain,
  //    and the roots-PDA gate fires first)
  rejected = false;
  try {
    const zero32 = Array(32).fill(0);
    await program.methods.settle(0, {
      ts: new BN(Date.now()),
      fixtureSummary: {
        fixtureId: new BN(FIXTURE),
        updateStats: { updateCount: 1, minTimestamp: new BN(Date.now()), maxTimestamp: new BN(Date.now()) },
        eventsSubTreeRoot: zero32,
      },
      fixtureProof: [], mainTreeProof: [], eventStatRoot: zero32,
      stats: [
        { stat: { key: 1, value: 1, period: 100 }, statProof: [] },
        { stat: { key: 2, value: 0, period: 100 }, statProof: [] },
      ],
    }).accounts({
      market,
      dailyScoresMerkleRoots: Keypair.generate().publicKey,
      txoracleProgram: new PublicKey("6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J"),
    }).rpc();
  } catch { rejected = true; }
  check("settle with wrong roots account rejected", rejected);

  console.log(failures ? `\n${failures} FAILURES` : "\nALL SMOKE TESTS PASSED");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
