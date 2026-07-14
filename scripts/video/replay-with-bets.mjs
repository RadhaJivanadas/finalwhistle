// Restart the France-Spain replay and land bets inside the betting window.
//   node scripts/video/replay-with-bets.mjs [baseUrl]
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.argv[2] || "http://localhost:8787";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = async (p, method = "GET") => (await fetch(`${BASE}${p}`, { method })).json();

// wait for any running demo to finish
while ((await api("/api/demo/status")).running) {
  console.log("waiting for current replay to finish…");
  await sleep(10000);
}

const prev = ((await api("/api/demo/status")).markets ?? []).join(",");
const start = await api("/api/demo/start?fixtureId=18237038&speed=8&bettingSecs=120", "POST");
console.log("demo:", JSON.stringify(start));

let markets;
for (let i = 0; i < 40; i++) {
  await sleep(3000);
  const s = await api("/api/demo/status");
  const cur = (s.markets ?? []).join(",");
  if (s.running && cur && cur !== prev) { markets = s.markets; break; }
}
if (!markets) { console.error("markets never appeared"); process.exit(1); }
console.log("markets:", markets.join(" / "));

const bets = [
  [markets[0], "2", "0.25"], // Spain (away) win — the actual result
  [markets[0], "0", "0.15"], // France, for a contested pool
  [markets[1], "1", "0.1"],  // Under 2.5 — the actual result (0:2)
];
for (const [addr, outcome, sol] of bets) {
  execFileSync("node", [path.join(ROOT, "scripts/place-bet.mjs"), addr, outcome, sol], { stdio: "inherit" });
}
console.log("BETS_DONE; markets=" + markets.join(","));
