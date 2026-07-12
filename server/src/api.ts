/**
 * HTTP surface: JSON API for the web app plus a fan-out SSE relay of live
 * TxLINE data, and static hosting of the built frontend.
 */
import express from "express";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { store } from "./store.js";
import * as txline from "./txline.js";
import * as chain from "./chain.js";
import { config } from "./config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp() {
  const app = express();
  app.use(express.json());

  app.get("/api/health", (_req, res) => {
    res.json({
      ok: true,
      keeper: chain.keeper.publicKey.toBase58(),
      program: chain.finalwhistle.programId.toBase58(),
      txoracle: chain.txoracle.programId.toBase58(),
      fixtures: store.fixtures.size,
      receipts: store.receipts.length,
    });
  });

  app.get("/api/fixtures", (_req, res) => {
    const list = [...store.fixtures.values()].sort((a, b) => a.startTime - b.startTime);
    res.json(list);
  });

  app.get("/api/live/:fixtureId", (req, res) => {
    res.json(store.live.get(Number(req.params.fixtureId)) ?? null);
  });

  app.get("/api/odds/:fixtureId", (req, res) => {
    res.json(store.odds.get(Number(req.params.fixtureId)) ?? null);
  });

  app.get("/api/markets", async (_req, res) => {
    try {
      const markets = await chain.fetchAllMarkets();
      res.json(markets);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/receipts", (_req, res) => res.json(store.receipts));

  app.get("/api/receipts/:market", (req, res) => {
    const r = store.receipts.find((x) => x.market === req.params.market);
    if (!r) return res.status(404).json({ error: "no receipt" });
    res.json(r);
  });

  /** Proof passthrough so the browser can re-verify a settlement without any
   *  TxLINE credentials of its own. */
  app.get("/api/proof", async (req, res) => {
    try {
      const { fixtureId, seq, statKeys } = req.query;
      const validation = await txline.fetchStatValidation(
        Number(fixtureId),
        Number(seq),
        String(statKeys).split(",").map(Number)
      );
      res.json(validation);
    } catch (e: any) {
      res.status(502).json({ error: e.response?.data ?? e.message });
    }
  });

  /** Demo replay controls (see demo.ts). Guarded by DEMO_KEY when set. */
  app.post("/api/demo/start", async (req, res) => {
    if (process.env.DEMO_KEY && req.query.key !== process.env.DEMO_KEY) {
      return res.status(403).json({ error: "bad demo key" });
    }
    const { runDemo, demoStatus } = await import("./demo.js");
    if (demoStatus.running) return res.status(409).json({ error: "demo already running", demoStatus });
    const fixtureId = Number(req.query.fixtureId ?? req.body?.fixtureId);
    const speed = Number(req.query.speed ?? 2);
    const bettingSecs = Number(req.query.bettingSecs ?? 90);
    if (!fixtureId) return res.status(400).json({ error: "fixtureId required" });
    runDemo(fixtureId, speed, bettingSecs).catch((e) => console.error("[demo] failed:", e.message));
    res.json({ started: true, fixtureId, speed, bettingSecs });
  });

  app.get("/api/demo/status", async (_req, res) => {
    const { demoStatus } = await import("./demo.js");
    res.json(demoStatus);
  });

  /** Server-Sent Events relay: browsers get every live update we ingest. */
  app.get("/api/stream", (req, res) => {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    });
    res.write(`event: hello\ndata: ${JSON.stringify({ now: Date.now() })}\n\n`);

    const onBroadcast = (msg: any) => {
      res.write(`event: ${msg.type}\ndata: ${JSON.stringify(msg.payload)}\n\n`);
    };
    store.on("broadcast", onBroadcast);
    const ping = setInterval(() => res.write(`: ping\n\n`), 25000);
    req.on("close", () => {
      clearInterval(ping);
      store.off("broadcast", onBroadcast);
    });
  });

  // Static frontend (built by `npm run build` in web/).
  const webDist = path.resolve(__dirname, "../../web/dist");
  if (fs.existsSync(webDist)) {
    app.use(express.static(webDist));
    app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(webDist, "index.html")));
  }

  return app;
}

export function startApi() {
  const app = createApp();
  app.listen(config.port, () => {
    console.log(`[api] listening on http://localhost:${config.port}`);
  });
}
