import { config } from "./config.js";
import { startApi } from "./api.js";
import { startKeeper } from "./keeper.js";

console.log("Final Whistle server starting");
console.log(`  TxLINE host: ${config.txlineHost}`);
console.log(`  RPC:         ${config.rpcUrl}`);

if (!config.txlineApiToken) {
  console.warn("WARNING: TXLINE_API_TOKEN not set — run scripts/setup-devnet.mjs first.");
}

startApi();
startKeeper();
