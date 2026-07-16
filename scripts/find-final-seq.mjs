// Find the game_finalised record seq (and final score) for a fixture.
//   node scripts/find-final-seq.mjs <fixtureId> <kickoffMs>
import axios from "axios";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, ".env.devnet"), "utf8")
  .split("\n").filter((l) => l.includes("=")).map((l) => l.split(/=(.*)/s).slice(0, 2)));

const fixtureId = Number(process.argv[2]);
const kickoffMs = Number(process.argv[3]);
if (!fixtureId || !kickoffMs) { console.error("usage: find-final-seq.mjs <fixtureId> <kickoffMs>"); process.exit(1); }

const jwt = (await axios.post(`${env.TXLINE_API_HOST}/auth/guest/start`)).data.token;
const headers = { Authorization: `Bearer ${jwt}`, "X-Api-Token": env.TXLINE_API_TOKEN };

const records = [];
for (let t = kickoffMs; t < kickoffMs + 4 * 3600_000; t += 300_000) {
  const day = Math.floor(t / 86_400_000);
  const d = new Date(t);
  const hour = d.getUTCHours();
  const interval = Math.floor(d.getUTCMinutes() / 5);
  try {
    const r = await axios.get(`${env.TXLINE_API_HOST}/api/scores/updates/${day}/${hour}/${interval}`, { headers });
    const recs = (r.data ?? []).filter((x) => Number(x.FixtureId ?? x.fixtureId) === fixtureId);
    records.push(...recs);
    if (recs.some((x) => (x.Action ?? x.action) === "game_finalised")) break;
  } catch { /* empty window */ }
}
console.log(`records: ${records.length}`);

const act = (r) => r.Action ?? r.action;
const seq = (r) => Number(r.Seq ?? r.seq);
const fin = records.filter((r) => act(r) === "game_finalised").sort((a, b) => seq(b) - seq(a))[0];
if (!fin) {
  const last = records.sort((a, b) => seq(a) - seq(b)).at(-1);
  console.log("NO game_finalised yet. Last record:", JSON.stringify(last));
  process.exit(2);
}
console.log("FINALISED:", JSON.stringify(fin));
console.log(`finalSeq=${seq(fin)}`);
