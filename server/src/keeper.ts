/**
 * The keeper: glues the TxLINE feed to the on-chain market lifecycle.
 *
 *  1. Poll /api/fixtures/snapshot -> create markets for upcoming fixtures.
 *  2. Consume /api/scores/stream  -> maintain live state, relay to browsers.
 *  3. On `action=game_finalised`  -> fetch Merkle proof, settle on-chain.
 *
 * Settlement is intentionally permissionless in the program; this keeper is
 * merely the first caller. Anyone can run one.
 */
import { config } from "./config.js";
import { store, LiveState } from "./store.js";
import * as txline from "./txline.js";
import * as chain from "./chain.js";

const STAT_KEYS = {
  goals: [1, 2],
  corners: [7, 8],
};

/** Soccer finalisation markers (see TxLINE soccer feed docs). */
const FINAL_STATUS = 100;

// ---------------------------------------------------------------------------
// Fixtures -> markets
// ---------------------------------------------------------------------------

function fixtureMatchesFilter(competition: string): boolean {
  if (!config.competitionFilter.length) return true;
  const c = (competition || "").toLowerCase();
  return config.competitionFilter.some((f) => c.includes(f));
}

export async function syncFixtures(): Promise<void> {
  const raw = await txline.fetchFixtures();
  let created = 0;
  for (const f of raw) {
    const fixtureId = Number(f.FixtureId ?? f.fixtureId);
    if (!fixtureId) continue;
    const info = {
      fixtureId,
      competition: f.Competition ?? "",
      competitionId: Number(f.CompetitionId ?? 0),
      home: f.Participant1IsHome === false ? f.Participant2 : f.Participant1,
      away: f.Participant1IsHome === false ? f.Participant1 : f.Participant2,
      homeId: f.Participant1IsHome === false ? f.Participant2Id : f.Participant1Id,
      awayId: f.Participant1IsHome === false ? f.Participant1Id : f.Participant2Id,
      startTime: Number(f.StartTime),
      gameState: f.GameState ?? f.gameState,
    };
    store.fixtures.set(fixtureId, info);

    // Auto-create markets for upcoming, covered fixtures.
    if (!config.autoMarkets) continue;
    if (!fixtureMatchesFilter(info.competition)) continue;
    if (info.gameState === 6) continue; // cancelled
    const kickoffSec = Math.floor(info.startTime / 1000);
    if (info.startTime < Date.now()) continue; // already started

    for (const [kind, line] of [
      [chain.MarketKind.Winner, 0],
      [chain.MarketKind.TotalGoals, config.defaultGoalsLine],
    ] as const) {
      try {
        const res = await chain.createMarket(fixtureId, kind, line, kickoffSec);
        if (res) {
          created++;
          store.markets.set(res.market.toBase58(), {
            fixtureId, kind, line, kickoffTs: kickoffSec, createTx: res.signature,
          });
          console.log(`[keeper] market created ${res.market.toBase58()} fixture=${fixtureId} kind=${kind}`);
        }
      } catch (e: any) {
        console.warn(`[keeper] createMarket failed fixture=${fixtureId}: ${e.message}`);
      }
    }
  }
  if (created) store.persist();
  store.broadcast("fixtures", [...store.fixtures.values()]);
  console.log(`[keeper] fixtures synced: ${store.fixtures.size} (markets created: ${created})`);
}

// ---------------------------------------------------------------------------
// Scores stream
// ---------------------------------------------------------------------------

/** Field access tolerant to PascalCase/camelCase variants in feed payloads. */
function pick(obj: any, ...names: string[]): any {
  for (const n of names) {
    if (obj?.[n] !== undefined) return obj[n];
    const lower = n[0].toLowerCase() + n.slice(1);
    if (obj?.[lower] !== undefined) return obj[lower];
    const upper = n[0].toUpperCase() + n.slice(1);
    if (obj?.[upper] !== undefined) return obj[upper];
  }
  return undefined;
}

export function applyScoreRecord(rec: any): LiveState | null {
  const fixtureId = Number(pick(rec, "fixtureId"));
  if (!fixtureId) return null;
  const s = store.liveFor(fixtureId);

  const seq = Number(pick(rec, "seq") ?? 0);
  if (seq && s.seq && seq <= s.seq && !pick(rec, "action")) return s;
  s.seq = seq || s.seq;
  s.ts = Number(pick(rec, "ts") ?? Date.now());
  s.gameState = pick(rec, "gameState");
  const statusId = pick(rec, "statusSoccerId", "statusId");
  if (statusId !== undefined) s.statusId = Number(statusId);

  const action = pick(rec, "action");
  if (action) s.lastAction = action;

  // Total score from the soccer score object when present.
  const scoreSoccer = pick(rec, "scoreSoccer", "score");
  const p1Total = scoreSoccer?.Participant1?.Total ?? scoreSoccer?.participant1?.total;
  const p2Total = scoreSoccer?.Participant2?.Total ?? scoreSoccer?.participant2?.total;
  const goalsOf = (t: any) => Number(pick(t ?? {}, "Goals", "goals") ?? NaN);
  const cornersOf = (t: any) => Number(pick(t ?? {}, "Corners", "corners") ?? NaN);
  if (!Number.isNaN(goalsOf(p1Total))) s.homeGoals = goalsOf(p1Total);
  if (!Number.isNaN(goalsOf(p2Total))) s.awayGoals = goalsOf(p2Total);
  if (!Number.isNaN(cornersOf(p1Total))) s.homeCorners = cornersOf(p1Total);
  if (!Number.isNaN(cornersOf(p2Total))) s.awayCorners = cornersOf(p2Total);

  // Fallback: flat stats map { "1": home goals, "2": away goals, ... }.
  const stats = pick(rec, "stats");
  if (stats && typeof stats === "object") {
    if (stats["1"] !== undefined) s.homeGoals = Number(stats["1"]);
    if (stats["2"] !== undefined) s.awayGoals = Number(stats["2"]);
    if (stats["7"] !== undefined) s.homeCorners = Number(stats["7"]);
    if (stats["8"] !== undefined) s.awayCorners = Number(stats["8"]);
  }

  const dataSoccer = pick(rec, "dataSoccer", "data");
  const minutes = pick(dataSoccer ?? {}, "Minutes", "minutes") ?? pick(dataSoccer?.Clock ?? {}, "Minutes");
  if (minutes !== undefined) s.minutes = Number(minutes);

  if (action && !["comment", "clock", "heartbeat"].includes(action)) {
    s.events.push({
      seq,
      ts: s.ts!,
      action,
      participant: pick(rec, "participant"),
      minutes: s.minutes,
      detail: dataSoccer ? JSON.stringify(dataSoccer).slice(0, 300) : undefined,
    });
    if (s.events.length > 250) s.events.splice(0, s.events.length - 250);
  }

  if (action === "game_finalised" || Number(statusId) === FINAL_STATUS) {
    s.finalised = true;
    s.finalSeq = seq || s.finalSeq;
  }
  return s;
}

async function onScoresMessage(_event: string | undefined, data: unknown) {
  if (!data || typeof data !== "object") return;
  const s = applyScoreRecord(data);
  if (!s) return;
  store.broadcast("score", s);

  if (s.finalised && s.finalSeq) {
    settleFixture(s.fixtureId, s.finalSeq).catch((e) =>
      console.error(`[keeper] settlement failed fixture=${s.fixtureId}:`, e.message)
    );
  }
}

// ---------------------------------------------------------------------------
// Settlement
// ---------------------------------------------------------------------------

const settling = new Set<string>();
const lastAttempt = new Map<number, number>();

export async function settleFixture(fixtureId: number, finalSeq: number): Promise<void> {
  // The finalised record can be re-broadcast; don't hammer the RPC.
  const last = lastAttempt.get(fixtureId) ?? 0;
  if (Date.now() - last < 30_000) return;
  lastAttempt.set(fixtureId, Date.now());

  const markets = await chain.fetchAllMarkets();
  const open = markets.filter((m) => m.fixtureId === fixtureId && m.state === "open");
  if (!open.length) return;

  for (const m of open) {
    if (settling.has(m.address)) continue;
    settling.add(m.address);
    try {
      const statKeys = m.kind === "totalCorners" ? STAT_KEYS.corners : STAT_KEYS.goals;
      const validation = await txline.fetchStatValidation(fixtureId, finalSeq, statKeys);
      const stats = validation.statsToProve ?? [];
      if (stats.length !== 2) throw new Error(`unexpected statsToProve length ${stats.length}`);

      const [homeVal, awayVal] = [Number(stats[0].value), Number(stats[1].value)];
      let outcome: number;
      let label: string;
      if (m.kind === "winner") {
        outcome = homeVal > awayVal ? 0 : homeVal === awayVal ? 1 : 2;
        label = ["Home win", "Draw", "Away win"][outcome];
      } else {
        const total = homeVal + awayVal;
        outcome = total > m.line ? 0 : 1;
        label = outcome === 0 ? `Over ${m.line}.5` : `Under ${m.line}.5`;
      }

      const kindNum = { winner: 0, totalGoals: 1, totalCorners: 2 }[m.kind as string]!;
      const signature = await chain.settleMarket(m.address, outcome, validation);
      const { pda, epochDay } = chain.dailyScoresPda(validation.summary.updateStats.minTimestamp);

      store.receipts.push({
        market: m.address,
        fixtureId,
        kind: m.kind,
        line: m.line,
        winningOutcome: outcome,
        outcomeLabel: label,
        seq: finalSeq,
        statKeys,
        proof: validation,
        strategy: chain.describeStrategy(kindNum, m.line, outcome),
        txSignature: signature,
        epochDay,
        dailyScoresPda: pda.toBase58(),
        settledAt: Date.now(),
      });
      store.persist();
      store.broadcast("settled", store.receipts[store.receipts.length - 1]);
      console.log(`[keeper] SETTLED ${m.address} fixture=${fixtureId} ${label} tx=${signature}`);
    } catch (e: any) {
      console.error(`[keeper] settle ${m.address}: ${e.message}`);
      settling.delete(m.address); // allow retry on next finalised record
    }
  }
}

// ---------------------------------------------------------------------------
// Odds stream
// ---------------------------------------------------------------------------

function onOddsMessage(_event: string | undefined, data: unknown) {
  if (!data || typeof data !== "object") return;
  const rec: any = data;
  // OddsPayload may wrap a list; normalize to individual odds entries.
  const entries = Array.isArray(rec) ? rec : rec.odds ?? rec.Odds ?? [rec];
  for (const o of entries) {
    const fixtureId = Number(pick(o, "FixtureId"));
    if (!fixtureId) continue;
    let st = store.odds.get(fixtureId);
    if (!st) {
      st = { fixtureId, history: [] };
      store.odds.set(fixtureId, st);
    }
    const prices = pick(o, "Prices");
    st.bookmaker = pick(o, "Bookmaker") ?? st.bookmaker;
    st.superOddsType = pick(o, "SuperOddsType") ?? st.superOddsType;
    st.priceNames = pick(o, "PriceNames") ?? st.priceNames;
    st.ts = Number(pick(o, "Ts") ?? Date.now());
    if (Array.isArray(prices) && prices.length) {
      st.prices = prices;
      st.history.push({ ts: st.ts!, prices });
      if (st.history.length > 500) st.history.splice(0, st.history.length - 500);
    }
    store.broadcast("odds", { ...st, history: undefined });
  }
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

export function startKeeper() {
  syncFixtures().catch((e) => console.error("[keeper] fixtures sync failed:", e.message));
  setInterval(() => {
    syncFixtures().catch((e) => console.error("[keeper] fixtures sync failed:", e.message));
  }, 5 * 60 * 1000);

  txline.streamForever("/api/scores/stream", onScoresMessage, "scores");
  txline.streamForever("/api/odds/stream", onOddsMessage, "odds");
  console.log("[keeper] started");
}
