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

if (config.demoAutoloop) {
  const { startDemoAutoloop } = await import("./demo.js");
  startDemoAutoloop();
  console.log("[demo] autoloop enabled");
}

// Free-tier hosts (e.g. Render free plan) spin the instance down after ~15 min
// without inbound traffic, which would pause the keeper and miss settlements.
// Pinging our own public URL counts as inbound traffic and keeps us awake.
const publicUrl = process.env.KEEPALIVE_URL || process.env.RENDER_EXTERNAL_URL;
if (publicUrl) {
  setInterval(() => {
    fetch(`${publicUrl}/api/health`).catch(() => {});
  }, 5 * 60 * 1000);
  console.log(`[keepalive] pinging ${publicUrl}/api/health every 5 min`);
}
