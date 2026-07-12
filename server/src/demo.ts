/**
 * Demo replay: re-broadcasts a finished fixture's real TxLINE score records
 * as if the match were live, then performs a REAL on-chain settlement with
 * the REAL Merkle proof of its finalised record.
 *
 * Nothing here is mocked — the records come from /api/scores/historical and
 * the proof from /api/scores/stat-validation; only the pacing is compressed.
 * This exists because judging happens after the World Cup final, when no
 * matches are live (the bounty explicitly allows simulated feeds).
 */
import { store } from "./store.js";
import * as txline from "./txline.js";
import * as chain from "./chain.js";
import { applyScoreRecord, settleFixture } from "./keeper.js";

export interface DemoStatus {
  running: boolean;
  fixtureId?: number;
  nonce?: number;
  step?: number;
  total?: number;
  markets?: string[];
  error?: string;
}

export const demoStatus: DemoStatus = { running: false };

/**
 * @param fixtureId   fixture with historical data (started 6h..2w ago)
 * @param speed       records per second to replay
 * @param bettingSecs how long to keep betting open before the replay starts
 */
export async function runDemo(fixtureId: number, speed = 2, bettingSecs = 90): Promise<DemoStatus> {
  if (demoStatus.running) throw new Error("demo already running");
  Object.assign(demoStatus, { running: true, fixtureId, error: undefined });

  try {
    const records = await txline.fetchHistoricalScores(fixtureId);
    if (!records.length) throw new Error(`no historical records for fixture ${fixtureId}`);
    demoStatus.total = records.length;

    // A fresh nonce lets the same fixture host repeated demo markets.
    const nonce = (Date.now() % 60000) + 1;
    demoStatus.nonce = nonce;
    const kickoff = Math.floor(Date.now() / 1000) + bettingSecs;

    const created: string[] = [];
    for (const [kind, line] of [
      [chain.MarketKind.Winner, 0],
      [chain.MarketKind.TotalGoals, 2],
    ] as const) {
      const res = await chain.createMarket(fixtureId, kind, line, kickoff, nonce);
      if (res) {
        created.push(res.market.toBase58());
        store.markets.set(res.market.toBase58(), {
          fixtureId, kind, line, nonce, kickoffTs: kickoff, createTx: res.signature, demo: true,
        });
      }
    }
    demoStatus.markets = created;
    store.persist();
    store.broadcast("demo", { ...demoStatus, phase: "betting", kickoff });
    console.log(`[demo] fixture=${fixtureId} nonce=${nonce} markets=${created.join(",")}`);

    // Reset live state so the replay starts from a clean slate.
    store.live.delete(fixtureId);

    // Let people bet, then replay.
    await new Promise((r) => setTimeout(r, bettingSecs * 1000));
    store.broadcast("demo", { ...demoStatus, phase: "replay" });

    let finalSeq: number | undefined;
    for (let i = 0; i < records.length; i++) {
      demoStatus.step = i + 1;
      const rec = records[i];
      const s = applyScoreRecord(rec);
      if (s) {
        store.broadcast("score", s);
        if (s.finalised && s.finalSeq) finalSeq = s.finalSeq;
      }
      await new Promise((r) => setTimeout(r, 1000 / speed));
    }

    if (finalSeq) {
      console.log(`[demo] replay complete, settling with finalised seq=${finalSeq}`);
      await settleFixture(fixtureId, finalSeq);
    } else {
      console.warn("[demo] no game_finalised record found in historical data");
    }
    store.broadcast("demo", { ...demoStatus, phase: "done" });
    return { ...demoStatus };
  } catch (e: any) {
    demoStatus.error = e.message;
    throw e;
  } finally {
    demoStatus.running = false;
  }
}
