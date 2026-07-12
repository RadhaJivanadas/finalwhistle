export interface FixtureInfo {
  fixtureId: number;
  competition: string;
  competitionId: number;
  home: string;
  away: string;
  startTime: number;
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
  participant?: number;
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
  history?: { ts: number; prices: number[] }[];
}

export interface MarketInfo {
  address: string;
  fixtureId: number;
  kind: "winner" | "totalGoals" | "totalCorners";
  line: number;
  nonce: number;
  kickoffTs: number;
  state: "open" | "settled" | "void";
  winningOutcome: number;
  pools: string[];
  settledTs: number;
}

export interface SettlementReceipt {
  market: string;
  fixtureId: number;
  kind: string;
  line: number;
  winningOutcome: number;
  outcomeLabel: string;
  seq: number;
  statKeys: number[];
  proof: any;
  strategy: any;
  txSignature: string;
  epochDay: number;
  dailyScoresPda: string;
  settledAt: number;
}

export const OUTCOME_LABELS: Record<string, string[]> = {
  winner: ["Home", "Draw", "Away"],
  totalGoals: ["Over", "Under"],
  totalCorners: ["Over", "Under"],
};

export function marketTitle(m: MarketInfo): string {
  if (m.kind === "winner") return "Match winner";
  if (m.kind === "totalGoals") return `Total goals O/U ${m.line}.5`;
  return `Total corners O/U ${m.line}.5`;
}
