// Claim a settled position of the keeper wallet:
//   node scripts/claim.mjs <marketAddress> <outcome>
import anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const { AnchorProvider, Program, Wallet } = anchor;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const [market, outcome] = [process.argv[2], Number(process.argv[3])];
if (!market || Number.isNaN(outcome)) {
  console.error("usage: node scripts/claim.mjs <marketAddress> <outcome>");
  process.exit(1);
}

const env = Object.fromEntries(
  fs.readFileSync(path.join(ROOT, ".env.devnet"), "utf8")
    .split("\n").filter((l) => l.includes("=")).map((l) => l.split(/=(.*)/s).slice(0, 2))
);
const connection = new Connection(env.RPC_URL || "https://api.devnet.solana.com", "confirmed");
const keeper = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(path.join(ROOT, ".keys/keeper.json"), "utf8"))));
const provider = new AnchorProvider(connection, new Wallet(keeper), { commitment: "confirmed" });
const program = new Program(JSON.parse(fs.readFileSync(path.join(ROOT, "server/idl/finalwhistle.json"), "utf8")), provider);

const marketPk = new PublicKey(market);
const [vault] = PublicKey.findProgramAddressSync([Buffer.from("vault"), marketPk.toBuffer()], program.programId);
const [position] = PublicKey.findProgramAddressSync(
  [Buffer.from("position"), marketPk.toBuffer(), keeper.publicKey.toBuffer(), Buffer.from([outcome])],
  program.programId
);

const before = await connection.getBalance(keeper.publicKey);
const sig = await program.methods.claim()
  .accounts({ market: marketPk, vault, position, bettor: keeper.publicKey, systemProgram: SystemProgram.programId })
  .rpc();
await new Promise((s) => setTimeout(s, 2000));
const after = await connection.getBalance(keeper.publicKey);
console.log(`claimed ${((after - before) / LAMPORTS_PER_SOL).toFixed(4)} SOL — tx ${sig}`);
