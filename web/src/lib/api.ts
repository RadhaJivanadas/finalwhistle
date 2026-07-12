/** REST + SSE client for the Final Whistle server. */
import { useEffect, useState } from "react";
import type { FixtureInfo, LiveState, MarketInfo, OddsState, SettlementReceipt } from "./types";

export async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

export const fetchFixtures = () => getJson<FixtureInfo[]>("/api/fixtures");
export const fetchMarkets = () => getJson<MarketInfo[]>("/api/markets");
export const fetchReceipts = () => getJson<SettlementReceipt[]>("/api/receipts");
export const fetchReceipt = (market: string) => getJson<SettlementReceipt>(`/api/receipts/${market}`);
export const fetchLive = (fixtureId: number) => getJson<LiveState | null>(`/api/live/${fixtureId}`);
export const fetchOdds = (fixtureId: number) => getJson<OddsState | null>(`/api/odds/${fixtureId}`);

// ---------------------------------------------------------------------------
// Live updates: one shared EventSource, fan-out to subscribers.
// ---------------------------------------------------------------------------

type Handler = (payload: any) => void;
const handlers = new Map<string, Set<Handler>>();
let source: EventSource | null = null;

function ensureSource() {
  if (source) return;
  source = new EventSource("/api/stream");
  for (const type of ["score", "odds", "fixtures", "settled", "demo", "hello"]) {
    source.addEventListener(type, (e) => {
      const payload = JSON.parse((e as MessageEvent).data);
      handlers.get(type)?.forEach((h) => h(payload));
    });
  }
  source.onerror = () => {
    source?.close();
    source = null;
    setTimeout(ensureSource, 3000);
  };
}

export function subscribe(type: string, handler: Handler): () => void {
  ensureSource();
  if (!handlers.has(type)) handlers.set(type, new Set());
  handlers.get(type)!.add(handler);
  return () => handlers.get(type)!.delete(handler);
}

/** React hook: latest live state for one fixture, streamed. */
export function useLive(fixtureId: number | undefined): LiveState | null {
  const [state, setState] = useState<LiveState | null>(null);
  useEffect(() => {
    if (!fixtureId) return;
    fetchLive(fixtureId).then(setState).catch(() => {});
    return subscribe("score", (s: LiveState) => {
      if (s.fixtureId === fixtureId) setState({ ...s });
    });
  }, [fixtureId]);
  return state;
}

/** React hook: all live states keyed by fixture (for the home grid). */
export function useLiveMap(): Map<number, LiveState> {
  const [map, setMap] = useState<Map<number, LiveState>>(new Map());
  useEffect(
    () =>
      subscribe("score", (s: LiveState) => {
        setMap((prev) => new Map(prev).set(s.fixtureId, s));
      }),
    []
  );
  return map;
}

export function useOdds(fixtureId: number | undefined): OddsState | null {
  const [state, setState] = useState<OddsState | null>(null);
  useEffect(() => {
    if (!fixtureId) return;
    fetchOdds(fixtureId).then(setState).catch(() => {});
    return subscribe("odds", (o: OddsState) => {
      if (o.fixtureId === fixtureId)
        setState((prev) => ({ ...o, history: [...(prev?.history ?? []), { ts: o.ts!, prices: o.prices! }] }));
    });
  }, [fixtureId]);
  return state;
}
