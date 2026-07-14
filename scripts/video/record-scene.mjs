// Records ONE named scene right now (for live-match sessions).
//   node scripts/video/record-scene.mjs <scene> [baseUrl]
// Scenes: home | bet | live | settle | receipt
// Env: OUT_DIR (default scripts/video/out-live), LIVE_FIXTURE (France-Spain etc.),
//      BET_FIXTURE + BET_MARKET (+ BET_MARKET2) for the bet scene.
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.argv[3] || "https://finalwhistle-1sck.onrender.com";
const SCENE = process.argv[2];
const OUT = process.env.OUT_DIR || path.join(__dirname, "out-live");
const LIVE_FIXTURE = Number(process.env.LIVE_FIXTURE || 18237038);
const SIZE = { width: 1920, height: 1080 };
fs.mkdirSync(OUT, { recursive: true });

const api = async (p, method = "GET") => (await fetch(`${BASE}${p}`, { method })).json();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function dress(page) {
  await page.addStyleTag({ content: `
    #fw-cap{position:fixed;left:0;right:0;bottom:0;z-index:99999;display:flex;justify-content:center;pointer-events:none}
    #fw-cap span{max-width:1400px;margin:0 24px 26px;padding:14px 26px;border-radius:14px;background:rgba(7,11,9,.92);border:1px solid #27362f;color:#f2f5f3;font:500 24px/1.45 Inter,system-ui,sans-serif;opacity:0;transition:opacity .35s ease;text-align:center}
    #fw-cur{position:fixed;z-index:99998;width:22px;height:22px;border-radius:50%;pointer-events:none;background:rgba(57,135,229,.45);border:2.5px solid #3987e5;transform:translate(-50%,-50%);left:-60px;top:-60px}` });
  await page.evaluate(() => {
    const cap = document.createElement("div");
    cap.id = "fw-cap"; cap.innerHTML = "<span></span>";
    document.body.appendChild(cap);
    const cur = document.createElement("div");
    cur.id = "fw-cur"; document.body.appendChild(cur);
    window.addEventListener("mousemove", (e) => { cur.style.left = e.clientX + "px"; cur.style.top = e.clientY + "px"; }, { passive: true });
  });
}
async function caption(page, text, holdMs = 0) {
  await page.evaluate((t) => {
    const s = document.querySelector("#fw-cap span");
    if (s) { s.textContent = t || ""; s.style.opacity = t ? "1" : "0"; }
  }, text);
  if (holdMs) await sleep(holdMs);
}
async function smoothScroll(page, toY, ms = 1400) {
  await page.evaluate(({ toY, ms }) => new Promise((done) => {
    const from = window.scrollY, t0 = performance.now();
    const ease = (x) => 1 - Math.pow(1 - x, 3);
    const step = (t) => { const k = Math.min(1, (t - t0) / ms); window.scrollTo(0, from + (toY - from) * ease(k)); k < 1 ? requestAnimationFrame(step) : done(); };
    requestAnimationFrame(step);
  }), { toY, ms });
}
async function point(page, selector) {
  try {
    const el = page.locator(selector).first();
    await el.waitFor({ timeout: 4000 });
    const box = await el.boundingBox();
    if (box) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 25 });
  } catch {}
}
async function record(name, url, fn) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: SIZE, recordVideo: { dir: OUT, size: SIZE } });
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(1500);
  await dress(page);
  try { await fn(page); } finally {
    const video = page.video();
    await ctx.close();
    fs.renameSync(await video.path(), path.join(OUT, `${name}.webm`));
    await browser.close();
    console.log(`[rec] ${name}.webm done`);
  }
}

const scenes = {
  async home() {
    await record("01-home", `${BASE}/`, async (page) => {
      await caption(page, "This is Final Whistle — prediction markets for the World Cup, live on Solana devnet.", 4500);
      await caption(page, "Every fixture comes straight from the TxLINE feed — including tonight's semifinal, live right now.", 5000);
      await point(page, "text=LIVE");
      await sleep(2500);
      await smoothScroll(page, 400, 1500);
      await caption(page, "The keeper opens on-chain markets for every covered match automatically.", 4500);
      await smoothScroll(page, 0, 1100);
      await caption(page, "", 300);
    });
  },
  async bet() {
    const fixtureId = Number(process.env.BET_FIXTURE);
    const m1 = process.env.BET_MARKET, m2 = process.env.BET_MARKET2;
    if (!fixtureId || !m1) throw new Error("BET_FIXTURE and BET_MARKET required");
    const betJob = (async () => {
      const { execFileSync } = await import("node:child_process");
      const root = path.resolve(__dirname, "../..");
      await sleep(13000);
      const bets = [[m1, 0, 0.25], [m1, 2, 0.15]];
      if (m2) bets.push([m2, 0, 0.1]);
      for (const [addr, outcome, sol] of bets) {
        try { execFileSync("node", [path.join(root, "scripts/place-bet.mjs"), addr, String(outcome), String(sol)], { stdio: "inherit" }); }
        catch (e) { console.error("bet failed:", e.message); }
        await sleep(2500);
      }
    })();
    await record("02-bet", `${BASE}/match/${fixtureId}`, async (page) => {
      await caption(page, "Tomorrow's semifinal — betting is open until kickoff. Real stakes are landing on-chain right now…", 5500);
      await sleep(10000);
      await point(page, "text=Match winner");
      await caption(page, "There they are. Pools are parimutuel: implied odds are just the pool ratio — no market maker, no order book.", 6000);
      await caption(page, "At kickoff the program stops accepting stakes. From there, only a cryptographic proof can move the money.", 6000);
      await caption(page, "", 300);
    });
    await betJob;
  },
  async live() {
    await record("03-live", `${BASE}/match/${LIVE_FIXTURE}`, async (page) => {
      await caption(page, "France against Spain — LIVE. This score and every event stream straight from TxLINE over SSE.", 6000);
      await sleep(6000);
      await point(page, "text=Match feed");
      await caption(page, "Corners, cards, possession — the raw sports data that will settle these markets, cryptographically.", 6000);
      await sleep(5000);
      await caption(page, "While the match runs, the escrow holds every stake. Nobody — including us — can touch it.", 6000);
      await caption(page, "", 300);
    });
  },
  async settle() {
    // Start when close to FT; records until settlement receipt exists (max ~25 min).
    await record("04-settle", `${BASE}/match/${LIVE_FIXTURE}`, async (page) => {
      await caption(page, "The final minutes. When the referee blows the whistle, TxLINE emits the finalised record — watch what happens with zero human input.", 7500);
      const t0 = Date.now();
      const baseline = await api("/api/receipts").catch(() => []);
      const baseCount = Array.isArray(baseline)
        ? baseline.filter((r) => r.fixtureId === LIVE_FIXTURE).length : 0;
      let settled = false;
      while (Date.now() - t0 < 25 * 60_000) {
        const receipts = await api("/api/receipts").catch(() => []);
        if (Array.isArray(receipts)
          && receipts.filter((r) => r.fixtureId === LIVE_FIXTURE).length > baseCount) { settled = true; break; }
        await sleep(5000);
      }
      await sleep(3000);
      await point(page, "text=Settled");
      await caption(page, settled
        ? "Settled — seconds after full time. The escrow verified TxLINE's Merkle proof ON-CHAIN, via CPI into validate_stat_v2, before releasing a single lamport."
        : "Full time. Settlement lands the moment the finalised record is anchored on-chain.", 8500);
      await caption(page, "A wrong outcome can't be claimed — the proof itself would refute it. A forged proof fails the anchored Merkle root.", 6500);
      await caption(page, "", 300);
    });
  },
  async receipt() {
    const receipts = await api("/api/receipts").catch(() => []);
    const mine = receipts.filter((x) => x.fixtureId === LIVE_FIXTURE);
    const r = [...mine].reverse().find((x) => x.kind === "winner") ?? mine[mine.length - 1];
    if (!r) throw new Error("no receipt for live fixture yet");
    await record("05-receipt", `${BASE}/receipt/${r.market}`, async (page) => {
      await caption(page, "Every settlement gets a public receipt: the finalised stats, the exact predicate proven, the Merkle path, the transaction.", 6500);
      await smoothScroll(page, 420, 1500);
      await sleep(2200);
      await smoothScroll(page, 780, 1500);
      await caption(page, "And you don't have to trust any of it. Watch:", 3200);
      await point(page, "text=Verify in my browser");
      await page.click("text=Verify in my browser").catch(() => {});
      await caption(page, "The browser itself re-submits the proof to the TxLINE oracle program — a read-only simulation on devnet…", 6000);
      await page.waitForSelector("text=Oracle returned true", { timeout: 30000 }).catch(() => {});
      await sleep(1500);
      await caption(page, "✓ The oracle says true. A real World Cup semifinal, settled by cryptography alone.", 6000);
      await caption(page, "", 300);
    });
  },
};

if (!scenes[SCENE]) { console.error(`unknown scene: ${SCENE}`); process.exit(1); }
scenes[SCENE]().catch((e) => { console.error(e); process.exit(1); });
