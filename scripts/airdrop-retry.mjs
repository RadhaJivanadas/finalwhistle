import { Connection, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import fs from "fs";

const kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(".keys/keeper.json", "utf8"))));
const c = new Connection("https://api.devnet.solana.com", "confirmed");

for (let attempt = 1; attempt <= 60; attempt++) {
  const bal = await c.getBalance(kp.publicKey);
  if (bal >= 0.05 * LAMPORTS_PER_SOL) {
    console.log(`FUNDED balance=${bal / LAMPORTS_PER_SOL}`);
    process.exit(0);
  }
  for (const amt of [2, 1, 0.5]) {
    try {
      const sig = await c.requestAirdrop(kp.publicKey, amt * LAMPORTS_PER_SOL);
      await c.confirmTransaction(sig, "confirmed");
      console.log(`FUNDED airdrop=${amt} SOL`);
      process.exit(0);
    } catch (e) {
      console.error(`attempt ${attempt} amt ${amt}: ${String(e.message).slice(0, 60)}`);
    }
    await new Promise(r => setTimeout(r, 5000));
  }
  await new Promise(r => setTimeout(r, 8 * 60 * 1000));
}
console.log("GAVE UP");
process.exit(1);
