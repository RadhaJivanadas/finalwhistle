// Place a bet from the keeper wallet (handy for demos and testing):
//   node scripts/place-bet.mjs <marketAddress> <outcome> <sol>
import anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const { AnchorProvider, Program, Wallet, BN } = anchor;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const [market, outcome, sol] = [process.argv[2], Number(process.argv[3]), Number(process.argv[4])];
if (!market || Number.isNaN(outcome) || !sol) {
  console.error("usage: node scripts/place-bet.mjs <marketAddress> <outcome> <sol>");
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

const sig = await program.methods
  .placeBet(outcome, new BN(Math.round(sol * 1e9)))
  .accounts({ market: marketPk, vault, position, bettor: keeper.publicKey, systemProgram: SystemProgram.programId })
  .rpc();
console.log(`bet placed: ${sol} SOL on outcome ${outcome} — tx ${sig}`);
