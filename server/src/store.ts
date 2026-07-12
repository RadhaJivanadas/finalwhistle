/**
 * In-memory state with JSON snapshots on disk. Deliberately simple: the chain
 * is the source of truth for money; this store only caches feed data and
 * settlement receipts so the UI can render instantly.
 */
import fs from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import { config } from "./config.js";

export interface FixtureInfo {
  fixtureId: number;
  competition: string;
  competitionId: number;
  home: string;
  away: string;
  homeId: number;
  awayId: number;
  startTime: number; // ms epoch
  gameState?: number;
}

export interface LiveState {
  fixtureId: number;
  gameState?: string;
  statusId?: number;
  homeGoals: number;
  awayGoals: number;
  homeCorners: number;
  awayCorners: number;
  minutes?: number;
  lastAction?: string;
  finalised: boolean;
  finalSeq?: number;
  seq?: number;
  ts?: number;
  events: MatchEvent[];
}

export interface MatchEvent {
  seq: number;
  ts: number;
  action: string;
  participant?: number; // 1 | 2
  minutes?: number;
  detail?: string;
}

export interface OddsState {
  fixtureId: number;
  bookmaker?: string;
  superOddsType?: string;
  priceNames?: string[];
  prices?: number[];
  ts?: number;
  history: { ts: number; prices: number[] }[];
}

export interface SettlementReceipt {
  market: string;            // market PDA
  fixtureId: number;
  kind: string;
  line: number;
  winningOutcome: number;
  outcomeLabel: string;
  seq: number;               // finalised record sequence
  statKeys: number[];
  proof: any;                // raw /api/scores/stat-validation response
  strategy: any;             // predicate submitted on-chain
  txSignature: string;       // settlement transaction
  epochDay: number;
  dailyScoresPda: string;
  settledAt: number;
}

class Store extends EventEmitter {
  fixtures = new Map<number, FixtureInfo>();
  live = new Map<number, LiveState>();
  odds = new Map<number, OddsState>();
  receipts: SettlementReceipt[] = [];
  /** market PDA -> creation info mirror (chain remains source of truth) */
  markets = new Map<string, any>();

  private file(name: string) {
    return path.join(config.dataDir, name);
  }

  load() {
    try {
      const receipts = this.file("receipts.json");
      if (fs.existsSync(receipts)) this.receipts = JSON.parse(fs.readFileSync(receipts, "utf8"));
      const markets = this.file("markets.json");
      if (fs.existsSync(markets)) {
        this.markets = new Map(Object.entries(JSON.parse(fs.readFileSync(markets, "utf8"))));
      }
    } catch (e: any) {
      console.warn("[store] load failed:", e.message);
    }
  }

  persist() {
    fs.writeFileSync(this.file("receipts.json"), JSON.stringify(this.receipts, null, 2));
    fs.writeFileSync(
      this.file("markets.json"),
      JSON.stringify(Object.fromEntries(this.markets), null, 2)
    );
  }

  liveFor(fixtureId: number): LiveState {
    let s = this.live.get(fixtureId);
    if (!s) {
      s = {
        fixtureId,
        homeGoals: 0,
        awayGoals: 0,
        homeCorners: 0,
        awayCorners: 0,
        finalised: false,
        events: [],
      };
      this.live.set(fixtureId, s);
    }
    return s;
  }

  /** Broadcast a UI-facing event to every connected browser (via /api/live SSE). */
  broadcast(type: string, payload: unknown) {
    this.emit("broadcast", { type, payload, at: Date.now() });
  }
}

export const store = new Store();
store.load();
