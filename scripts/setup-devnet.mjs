// One-time devnet setup: create wallet, airdrop SOL, subscribe to TxLINE free tier,
// activate the API token, and persist credentials to .env.devnet.
import anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
} from "@solana/spl-token";
import axios from "axios";
import nacl from "tweetnacl";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const API_HOST = "https://txline-dev.txodds.com";
const RPC = process.env.RPC_URL || "https://api.devnet.solana.com";
const TOKEN_MINT = new PublicKey("4Zao8ocPhmMgq7PdsYWyxvqySMGx7xb9cMftPMkEokRG");
const IDL_PATH = path.join(ROOT, "server", "idl", "txoracle.json");
const KEY_PATH = path.join(ROOT, ".keys", "keeper.json");
const ENV_PATH = path.join(ROOT, ".env.devnet");

const SERVICE_LEVEL_ID = Number(process.env.SERVICE_LEVEL_ID || 1); // free tier
const WEEKS = 4;
const LEAGUES = []; // standard bundle

async function main() {
  fs.mkdirSync(path.dirname(KEY_PATH), { recursive: true });
  let keypair;
  if (fs.existsSync(KEY_PATH)) {
    keypair = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(KEY_PATH, "utf8"))));
    console.log("Loaded existing keeper wallet:", keypair.publicKey.toBase58());
  } else {
    keypair = Keypair.generate();
    fs.writeFileSync(KEY_PATH, JSON.stringify(Array.from(keypair.secretKey)));
    console.log("Generated keeper wallet:", keypair.publicKey.toBase58());
  }

  const connection = new Connection(RPC, "confirmed");
  let balance = await connection.getBalance(keypair.publicKey);
  console.log("Balance:", balance / 1e9, "SOL");
  if (balance < 0.5e9) {
    console.log("Requesting airdrop...");
    try {
      const sig = await connection.requestAirdrop(keypair.publicKey, 2e9);
      await connection.confirmTransaction(sig, "confirmed");
      balance = await connection.getBalance(keypair.publicKey);
      console.log("Airdropped. Balance:", balance / 1e9, "SOL");
    } catch (e) {
      console.error("Airdrop failed:", e.message);
      console.error("Fund the wallet manually (e.g. https://faucet.solana.com) and re-run.");
      if (balance === 0) process.exit(1);
    }
  }

  // Guest JWT
  const jwtRes = await axios.post(`${API_HOST}/auth/guest/start`);
  const jwt = jwtRes.data.token;
  console.log("Guest JWT acquired.");

  // Anchor program client
  const idl = JSON.parse(fs.readFileSync(IDL_PATH, "utf8"));
  const wallet = new anchor.Wallet(keypair);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
  const program = new anchor.Program(idl, provider);
  console.log("txoracle program:", program.programId.toBase58());

  // Ensure the user's Token-2022 ATA for TxL exists (required by subscribe accounts)
  const userAta = getAssociatedTokenAddressSync(TOKEN_MINT, keypair.publicKey, false, TOKEN_2022_PROGRAM_ID);
  const ataInfo = await connection.getAccountInfo(userAta);
  if (!ataInfo) {
    console.log("Creating Token-2022 ATA for TxL...");
    const tx = new Transaction().add(
      createAssociatedTokenAccountInstruction(
        keypair.publicKey, userAta, keypair.publicKey, TOKEN_MINT,
        TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID
      )
    );
    await anchor.web3.sendAndConfirmTransaction(connection, tx, [keypair], { commitment: "confirmed" });
    console.log("ATA created:", userAta.toBase58());
  }

  const [pricingMatrixPda] = PublicKey.findProgramAddressSync([Buffer.from("pricing_matrix")], program.programId);
  const [treasuryPda] = PublicKey.findProgramAddressSync([Buffer.from("token_treasury_v2")], program.programId);
  const treasuryVault = getAssociatedTokenAddressSync(TOKEN_MINT, treasuryPda, true, TOKEN_2022_PROGRAM_ID);

  const matrix = await program.account.pricingMatrix.fetch(pricingMatrixPda);
  console.log("Service levels:", matrix.rows.map(r =>
    `id=${r.rowId} price/wk=${r.pricePerWeekToken} sampling=${r.samplingIntervalSec}s`).join(" | "));

  console.log(`Subscribing: level ${SERVICE_LEVEL_ID}, ${WEEKS} weeks...`);
  const tx = await program.methods
    .subscribe(SERVICE_LEVEL_ID, WEEKS)
    .accounts({
      user: keypair.publicKey,
      pricingMatrix: pricingMatrixPda,
      tokenMint: TOKEN_MINT,
      userTokenAccount: userAta,
      tokenTreasuryVault: treasuryVault,
      tokenTreasuryPda: treasuryPda,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .transaction();

  const bh = await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = bh.blockhash;
  tx.feePayer = keypair.publicKey;
  tx.sign(keypair);
  const txSig = await connection.sendRawTransaction(tx.serialize());
  await connection.confirmTransaction({ signature: txSig, ...bh }, "confirmed");
  console.log("Subscribe tx:", txSig);

  // Activate API token: sign `${txSig}:${leagues}:${jwt}` with the subscribing wallet
  const message = `${txSig}:${LEAGUES.join(",")}:${jwt}`;
  const sigBytes = nacl.sign.detached(new TextEncoder().encode(message), keypair.secretKey);
  const walletSignature = Buffer.from(sigBytes).toString("base64");

  const act = await axios.post(
    `${API_HOST}/api/token/activate`,
    { txSig, walletSignature, leagues: LEAGUES },
    { headers: { Authorization: `Bearer ${jwt}` } }
  );
  const apiToken = act.data.token || act.data;
  console.log("API token activated.");

  fs.writeFileSync(ENV_PATH, [
    `TXLINE_API_HOST=${API_HOST}`,
    `TXLINE_API_TOKEN=${apiToken}`,
    `RPC_URL=${RPC}`,
    `KEEPER_KEYPAIR=${KEY_PATH}`,
    `TXORACLE_PROGRAM_ID=${program.programId.toBase58()}`,
    "",
  ].join("\n"));
  console.log("Credentials written to", ENV_PATH);
}

main().catch((e) => {
  console.error("FAILED:", e.response?.data ?? e);
  process.exit(1);
});
