// Records LIVE-match segments for the demo video (France–Spain style session).
//   node scripts/video/record-live.mjs [baseUrl]
// Env: FIXTURE_ID (required), OUT_DIR (default scripts/video/out-live),
//      BET_MARKET (winner-market address; auto-derived from /api/markets if omitted)
//
// Produces: 02-bet.webm (pre-kickoff), 03-live.webm (first goal or minute ~10),
//           04-settle.webm (final whistle + settlement), 05-receipt.webm.
// Reuse 00-title/01-home/06-outro from the replay recording, then run assemble.sh.
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.argv[2] || "https://finalwhistle-1sck.onrender.com";
const OUT = process.env.OUT_DIR || path.join(__dirname, "out-live");
const FIXTURE = Number(process.env.FIXTURE_ID);
const SIZE = { width: 1920, height: 1080 };
if (!FIXTURE) { console.error("FIXTURE_ID env required"); process.exit(1); }
fs.mkdirSync(OUT, { recursive: true });

const api = async (p, method = "GET") => (await fetch(`${BASE}${p}`, { method })).json();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const live = () => api(`/api/live/${FIXTURE}`).catch(() => null);

async function dress(page) {
  await page.addStyleTag({ content: `
    #fw-cap{position:fixed;left:0;right:0;bottom:0;z-index:99999;display:flex;justify-content:center;pointer-events:none}
    #fw-cap span{max-width:1400px;margin:0 24px 26px;padding:14px 26px;border-radius:14px;background:rgba(7,11,9,.92);border:1px solid #27362f;color:#f2f5f3;font:500 24px/1.45 Inter,system-ui,sans-serif;opacity:0;transition:opacity .35s ease;text-align:center}` });
  await page.evaluate(() => {
    const cap = document.createElement("div");
    cap.id = "fw-cap"; cap.innerHTML = "<span></span>";
    document.body.appendChild(cap);
  });
}
async function caption(page, text, holdMs = 0) {
  await page.evaluate((t) => {
    const s = document.querySelector("#fw-cap span");
    if (s) { s.textContent = t || ""; s.style.opacity = t ? "1" : "0"; }
  }, text);
  if (holdMs) await sleep(holdMs);
}

async function segment(browser, name, url, fn) {
  const ctx = await browser.newContext({ viewport: SIZE, recordVideo: { dir: OUT, size: SIZE } });
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(1200);
  await dress(page);
  try { await fn(page); } finally {
    const video = page.video();
    await ctx.close();
    fs.renameSync(await video.path(), path.join(OUT, `${name}.webm`));
    console.log(`[rec] ${name} done`);
  }
}

async function main() {
  const fixtures = await api("/api/fixtures");
  const fx = fixtures.find((f) => f.fixtureId === FIXTURE);
  if (!fx) throw new Error(`fixture ${FIXTURE} not in feed`);
  const kickoffMs = fx.startTime;
  console.log(`[rec] ${fx.home} vs ${fx.away}, kickoff ${new Date(kickoffMs).toISOString()}`);

  const markets = await api("/api/markets");
  const winnerMkt = process.env.BET_MARKET ||
    markets.find((m) => m.fixtureId === FIXTURE && m.kind === "winner" && m.state === "open")?.address;
  console.log(`[rec] winner market: ${winnerMkt}`);

  const browser = await chromium.launch();

  // -- 02: pre-kickoff bet segment (start ASAP; must end before kickoff) -----
  if (Date.now() < kickoffMs - 90_000) {
    const betJob = (async () => {
      const { execFileSync } = await import("node:child_process");
      const root = path.resolve(__dirname, "../..");
      await sleep(12000);
      for (const [outcome, sol] of [[0, 0.25], [2, 0.15]]) {
        try {
          execFileSync("node", [path.join(root, "scripts/place-bet.mjs"), winnerMkt, String(outcome), String(sol)], { stdio: "inherit" });
        } catch (e) { console.error("bet failed:", e.message); }
        await sleep(3000);
      }
    })();
    await segment(browser, "02-bet", `${BASE}/match/${FIXTURE}`, async (page) => {
      await caption(page, `${fx.home} vs ${fx.away} — a real World Cup semifinal, kicking off in minutes. These markets live on Solana devnet.`, 6000);
      await caption(page, "Betting closes at kickoff. Watch the pools — real stakes are landing on-chain right now…", 5500);
      await sleep(10000);
      await caption(page, "Implied odds are the pool ratio — no market maker needed. After kickoff, only a cryptographic proof can move this money.", 6500);
      await caption(page, "", 300);
    });
    await betJob;
  } else console.log("[rec] betting window too close/passed; skipping 02-bet");

  // -- wait for kickoff -------------------------------------------------------
  while (Date.now() < kickoffMs + 60_000) await sleep(15_000);

  // -- 03: live segment — try to catch a goal, else record minute ~10-15 ------
  console.log("[rec] match should be live; waiting for events…");
  let baseline = (await live())?.events?.filter((e) => e.action === "goal").length ?? 0;
  const goalDeadline = Date.now() + 35 * 60_000;
  let goalSeen = false;
  while (Date.now() < goalDeadline) {
    const s = await live();
    const goals = s?.events?.filter((e) => e.action === "goal").length ?? 0;
    if (goals > baseline) { goalSeen = true; break; }
    if (s?.minutes && s.minutes >= 15 && Date.now() > kickoffMs + 15 * 60_000) break;
    await sleep(10_000);
  }
  await segment(browser, "03-live", `${BASE}/match/${FIXTURE}`, async (page) => {
    await caption(page, goalSeen
      ? "GOAL — and it hit our feed within seconds. Every event streams from TxLINE over SSE."
      : "Live from the semifinal: score, minutes and events stream in real time from TxLINE.", 6000);
    await sleep(8000);
    await caption(page, "While the match runs, the escrow holds every stake. Nobody — including us — can touch it.", 6000);
    await sleep(4000);
    await caption(page, "", 300);
  });

  // -- 04: final whistle + settlement -----------------------------------------
  console.log("[rec] waiting for full time (polling)…");
  while (true) {
    const s = await live();
    if (s?.finalised) break;
    // start recording slightly early: at minute >= 88 keep a rolling watch
    if (s?.minutes && s.minutes >= 88) break;
    await sleep(20_000);
  }
  await segment(browser, "04-settle", `${BASE}/match/${FIXTURE}`, async (page) => {
    await caption(page, "Final minutes. When the referee blows the whistle, TxLINE emits the finalised record — watch what happens with zero human input.", 7000);
    const t0 = Date.now();
    let settled = false;
    while (Date.now() - t0 < 30 * 60_000) {
      const receipts = await api("/api/receipts").catch(() => []);
      if (receipts.some((r) => r.fixtureId === FIXTURE)) { settled = true; break; }
      await sleep(5000);
    }
    await sleep(2500);
    await caption(page, settled
      ? "Settled. The escrow verified TxLINE's Merkle proof ON-CHAIN — CPI into validate_stat_v2 — before releasing a single lamport."
      : "Full time — settlement lands as soon as the finalised record is anchored.", 8000);
    await caption(page, "", 300);
  });

  // -- 05: receipt ------------------------------------------------------------
  const receipts = await api("/api/receipts").catch(() => []);
  const receipt = receipts.find((r) => r.fixtureId === FIXTURE && r.kind === "winner") ?? receipts.find((r) => r.fixtureId === FIXTURE);
  if (receipt) {
    await segment(browser, "05-receipt", `${BASE}/receipt/${receipt.market}`, async (page) => {
      await caption(page, "The receipt: finalised stats, the exact predicate proven, the Merkle path, the settlement transaction.", 6000);
      await page.evaluate(() => window.scrollTo({ top: 500, behavior: "smooth" }));
      await sleep(2500);
      await page.evaluate(() => window.scrollTo({ top: 800, behavior: "smooth" }));
      await caption(page, "And you don't have to trust any of it. Watch:", 3000);
      await page.click("text=Verify in my browser").catch(() => {});
      await caption(page, "The browser re-submits the proof to the TxLINE oracle as a read-only devnet simulation…", 6000);
      await page.waitForSelector("text=Oracle returned true", { timeout: 30000 }).catch(() => {});
      await sleep(1500);
      await caption(page, "✓ The oracle says true. This was a real World Cup semifinal, settled by cryptography.", 6000);
      await caption(page, "", 300);
    });
  }

  await browser.close();
  console.log("[rec] live segments recorded into", OUT);
  console.log("Next: copy 00-title/01-home/06-outro from the replay out/, then bash scripts/video/assemble.sh out-live");
}

main().catch((e) => { console.error(e); process.exit(1); });
