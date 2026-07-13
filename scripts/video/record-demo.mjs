// Records the demo video segments with Playwright (one .webm per segment).
// Usage:  NODE_PATH=<dir with playwright> node scripts/video/record-demo.mjs [baseUrl]
// Env:    OUT_DIR (default scripts/video/out), SPEED (replay records/sec, default 6)
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.argv[2] || "https://finalwhistle-1sck.onrender.com";
const OUT = process.env.OUT_DIR || path.join(__dirname, "out");
const SPEED = Number(process.env.SPEED || 6);
const SIZE = { width: 1920, height: 1080 };
fs.mkdirSync(OUT, { recursive: true });

const api = async (p, method = "GET") => (await fetch(`${BASE}${p}`, { method })).json();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Inject the caption bar + visible cursor into the page. */
async function dress(page) {
  await page.addStyleTag({
    content: `
    #fw-cap{position:fixed;left:0;right:0;bottom:0;z-index:99999;display:flex;justify-content:center;pointer-events:none}
    #fw-cap span{max-width:1400px;margin:0 24px 26px;padding:14px 26px;border-radius:14px;
      background:rgba(7,11,9,.92);border:1px solid #27362f;color:#f2f5f3;
      font:500 24px/1.45 Inter,system-ui,sans-serif;opacity:0;transition:opacity .35s ease;text-align:center}
    #fw-cur{position:fixed;z-index:99998;width:22px;height:22px;border-radius:50%;pointer-events:none;
      background:rgba(57,135,229,.45);border:2.5px solid #3987e5;transform:translate(-50%,-50%);
      transition:left .05s linear,top .05s linear;left:-50px;top:-50px}`,
  });
  await page.evaluate(() => {
    const cap = document.createElement("div");
    cap.id = "fw-cap";
    cap.innerHTML = "<span></span>";
    document.body.appendChild(cap);
    const cur = document.createElement("div");
    cur.id = "fw-cur";
    document.body.appendChild(cur);
    window.addEventListener("mousemove", (e) => {
      cur.style.left = e.clientX + "px";
      cur.style.top = e.clientY + "px";
    }, { passive: true });
  });
}

async function caption(page, text, holdMs = 0) {
  await page.evaluate((t) => {
    const s = document.querySelector("#fw-cap span");
    if (!s) return;
    if (!t) { s.style.opacity = "0"; return; }
    s.textContent = t;
    s.style.opacity = "1";
  }, text);
  if (holdMs) await sleep(holdMs);
}

async function smoothScroll(page, toY, ms = 1400) {
  await page.evaluate(({ toY, ms }) => new Promise((done) => {
    const from = window.scrollY, t0 = performance.now();
    const ease = (x) => 1 - Math.pow(1 - x, 3);
    const step = (t) => {
      const k = Math.min(1, (t - t0) / ms);
      window.scrollTo(0, from + (toY - from) * ease(k));
      k < 1 ? requestAnimationFrame(step) : done();
    };
    requestAnimationFrame(step);
  }), { toY, ms });
}

async function point(page, selector) {
  try {
    const el = page.locator(selector).first();
    await el.waitFor({ timeout: 4000 });
    const box = await el.boundingBox();
    if (box) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 25 });
  } catch { /* non-fatal */ }
}

/** Record one segment into its own context; returns the webm path. */
async function segment(browser, name, url, fn) {
  const ctx = await browser.newContext({ viewport: SIZE, recordVideo: { dir: OUT, size: SIZE } });
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(1200);
  if (!url.startsWith("file:")) await dress(page);
  try {
    await fn(page);
  } finally {
    const video = page.video();
    await ctx.close();
    const p = await video.path();
    const dest = path.join(OUT, `${name}.webm`);
    fs.renameSync(p, dest);
    console.log(`[rec] ${name} -> ${dest}`);
  }
}

async function main() {
  console.log(`[rec] base=${BASE} out=${OUT} speed=${SPEED}`);
  const browser = await chromium.launch();

  // ---- 0/6: title & outro cards -------------------------------------------
  await segment(browser, "00-title", `file://${path.join(__dirname, "title.html")}`, async (page) => {
    await page.waitForTimeout(5500);
  });

  // ---- start a fresh demo replay ------------------------------------------
  let status = await api("/api/demo/status");
  if (status.running) {
    console.log("[rec] a demo is already running; waiting for it to finish…");
    while ((await api("/api/demo/status")).running) await sleep(10000);
  }
  const bettingSecs = 100;
  const prevMarkets = (status.markets ?? []).join(",");
  const start = await api(`/api/demo/start?speed=${SPEED}&bettingSecs=${bettingSecs}&fixtureId=${process.env.FIXTURE_ID || 18222446}`, "POST").catch(() => null);
  console.log("[rec] demo started:", JSON.stringify(start));
  // Market creation confirms on-chain a few seconds after start; wait until
  // the status exposes the NEW markets, not the previous run's.
  let marketAddr, fixtureId;
  for (let i = 0; i < 30; i++) {
    await sleep(3000);
    status = await api("/api/demo/status");
    const cur = (status.markets ?? []).join(",");
    if (status.running && cur && cur !== prevMarkets) {
      marketAddr = status.markets[0];
      fixtureId = status.fixtureId;
      break;
    }
  }
  console.log(`[rec] fixture=${fixtureId} markets=${status.markets}`);
  if (!marketAddr) throw new Error(`demo failed to start: ${JSON.stringify(status)}`);

  // ---- 1/6: home tour (during betting window) ------------------------------
  await segment(browser, "01-home", `${BASE}/`, async (page) => {
    await caption(page, "This is Final Whistle — prediction markets for the World Cup, live on Solana devnet.", 4200);
    await caption(page, "Every fixture comes straight from the TxLINE feed. Our keeper opens on-chain markets automatically.", 4500);
    await smoothScroll(page, 500, 1600);
    await caption(page, "Match winner and total-goals pools — parimutuel, escrowed in program-owned accounts.", 4500);
    await smoothScroll(page, 0, 1200);
    await caption(page, "", 400);
  });

  // ---- 2/6: match page + bet ----------------------------------------------
  const betPromise = (async () => {
    // Land real bets while the match page is on screen: winner + totals.
    const { execFileSync } = await import("node:child_process");
    const root = path.resolve(__dirname, "../..");
    const totalsAddr = status.markets?.[1];
    await sleep(14000);
    const bets = [[marketAddr, 0, 0.25], [marketAddr, 2, 0.15]];
    if (totalsAddr) bets.push([totalsAddr, 0, 0.1]);
    for (const [addr, outcome, sol] of bets) {
      try {
        execFileSync("node", [path.join(root, "scripts/place-bet.mjs"), addr, String(outcome), String(sol)], { stdio: "inherit" });
      } catch (e) { console.error("bet failed:", e.message); }
      await sleep(2500);
    }
  })();

  await segment(browser, "02-bet", `${BASE}/match/${fixtureId}`, async (page) => {
    await caption(page, "Match view: markets, live score and the TxLINE event feed, all in one place.", 4200);
    await point(page, "text=Match winner");
    await caption(page, "Betting is open until kickoff. Watch the pools — two bets are landing on-chain right now…", 5200);
    await sleep(9000);
    await point(page, "text=first bet");
    await caption(page, "There they are. Implied odds are just the pool ratio — no market maker, no order book.", 5200);
    await caption(page, "At kickoff the program stops accepting stakes. From here, only a cryptographic proof can move the money.", 5500);
    await caption(page, "", 300);
  });
  await betPromise;

  // ---- 3/6: live replay -----------------------------------------------------
  // Wait until the replay phase is under way.
  while (true) {
    const s = await api("/api/demo/status");
    if (!s.running) break;
    if (s.step && s.step > 30) break;
    await sleep(3000);
  }
  await segment(browser, "03-live", `${BASE}/match/${fixtureId}`, async (page) => {
    await caption(page, "Kickoff. This is a replay of a real World Cup match — every record below is genuine TxLINE data.", 5000);
    await caption(page, "Goals, cards, corners stream in live over SSE and the scoreboard ticks in real time.", 5000);
    await sleep(7000);
    await caption(page, "While the match runs, the escrow holds every stake. Nobody — including us — can touch it.", 5500);
    await sleep(5000);
    await caption(page, "", 300);
  });

  // ---- 4/6: settlement ------------------------------------------------------
  // Wait for the finalisation + settlement, with the page recording.
  await segment(browser, "04-settle", `${BASE}/match/${fixtureId}`, async (page) => {
    await caption(page, "The match is heading to full time. When TxLINE emits the finalised record, watch what happens — with zero human input.", 6000);
    // Poll receipts while recording; markets flip live via SSE.
    const t0 = Date.now();
    let receipts = [];
    while (Date.now() - t0 < 240000) {
      receipts = await api("/api/receipts").catch(() => []);
      if (receipts.some((r) => r.market === marketAddr)) break;
      await sleep(4000);
    }
    await sleep(2500);
    await point(page, "text=Settled");
    await caption(page, "Settled. The keeper fetched TxLINE's Merkle proof and called the escrow — which verified it ON-CHAIN via CPI into TxODDS's validate_stat_v2 before releasing a single lamport.", 8000);
    await caption(page, "A wrong outcome can't be claimed: the proof itself would refute it. A forged proof fails the anchored Merkle root.", 6000);
    await caption(page, "", 300);
  });

  // ---- 5/6: receipt + browser verification ---------------------------------
  await segment(browser, "05-receipt", `${BASE}/receipt/${marketAddr}`, async (page) => {
    await caption(page, "Every settlement gets a public receipt: the finalised stats, the exact predicate proven, the Merkle path, the transaction.", 6000);
    await smoothScroll(page, 420, 1600);
    await sleep(2000);
    await smoothScroll(page, 760, 1600);
    await caption(page, "And you don't have to trust any of it. Watch:", 3000);
    await point(page, "text=Verify in my browser");
    await page.click("text=Verify in my browser").catch(() => {});
    await caption(page, "The browser itself just re-submitted the proof to the TxLINE oracle program as a read-only simulation on devnet…", 6500);
    await page.waitForSelector("text=Oracle returned true", { timeout: 30000 }).catch(() => {});
    await sleep(1500);
    await caption(page, "✓ The oracle says true. Anyone auditing this market can do the same, forever.", 5500);
    await caption(page, "", 300);
  });

  // ---- 6/6: outro -----------------------------------------------------------
  await segment(browser, "06-outro", `file://${path.join(__dirname, "outro.html")}`, async (page) => {
    await page.waitForTimeout(9000);
  });

  await browser.close();
  console.log("[rec] all segments recorded into", OUT);
}

main().catch((e) => { console.error(e); process.exit(1); });
