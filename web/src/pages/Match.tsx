import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { fetchFixtures, fetchMarkets, useLive, useOdds } from "../lib/api";
import type { FixtureInfo, MarketInfo } from "../lib/types";
import { MarketCard } from "../components/MarketCard";
import { OddsChart, ProbBars, SERIES } from "../components/charts";
import { pricesToProbs } from "../lib/format";

const ACTION_ICONS: Record<string, string> = {
  goal: "⚽", own_goal: "⚽", penalty: "🎯", yellow_card: "🟨", red_card: "🟥",
  corner: "🚩", substitution: "🔁", shot: "🥅", var: "📺", var_end: "📺",
  game_started: "▶️", game_finalised: "🏁", halftime_finalised: "⏸", free_kick: "⚡",
};

export function MatchPage() {
  const { fixtureId: fid } = useParams();
  const fixtureId = Number(fid);
  const [fixture, setFixture] = useState<FixtureInfo | null>(null);
  const [markets, setMarkets] = useState<MarketInfo[]>([]);
  const live = useLive(fixtureId);
  const odds = useOdds(fixtureId);

  useEffect(() => {
    fetchFixtures().then((fs) => setFixture(fs.find((f) => f.fixtureId === fixtureId) ?? null)).catch(() => {});
    const load = () => fetchMarkets().then((ms) => setMarkets(ms.filter((m) => m.fixtureId === fixtureId))).catch(() => {});
    load();
    const t = setInterval(load, 20000);
    return () => clearInterval(t);
  }, [fixtureId]);

  const oddsProbs = useMemo(() => {
    if (!odds?.prices?.length) return null;
    return pricesToProbs(odds.prices.slice(0, 3));
  }, [odds?.prices]);

  const isLive = live && !live.finalised && (live.seq ?? 0) > 0;

  return (
    <div className="space-y-6">
      {/* Scoreboard */}
      <section className="rounded-3xl border border-pitch-700 bg-pitch-900 p-6">
        <div className="flex items-center justify-between text-xs text-ink-500">
          <span>{fixture?.competition ?? ""}</span>
          {isLive && (
            <span className="flex items-center gap-1.5 font-medium text-bad">
              <span className="live-dot inline-block h-2 w-2 rounded-full bg-bad" />
              LIVE {live?.minutes ? `${live.minutes}′` : ""} · {live?.gameState}
            </span>
          )}
          {live?.finalised && <span className="font-medium text-good">🏁 FULL TIME — finalised on feed</span>}
        </div>
        <div className="mt-3 grid grid-cols-[1fr_auto_1fr] items-center gap-4">
          <div className="text-right">
            <div className="text-xl font-bold sm:text-2xl">{fixture?.home ?? "Home"}</div>
            <div className="mt-1 text-xs text-ink-500">corners {live?.homeCorners ?? 0}</div>
          </div>
          <div className="mono rounded-2xl bg-pitch-800 px-5 py-3 text-3xl font-bold">
            {live ? `${live.homeGoals} : ${live.awayGoals}` : "– : –"}
          </div>
          <div>
            <div className="text-xl font-bold sm:text-2xl">{fixture?.away ?? "Away"}</div>
            <div className="mt-1 text-xs text-ink-500">corners {live?.awayCorners ?? 0}</div>
          </div>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          {/* Markets */}
          <section>
            <h2 className="mb-3 text-lg font-semibold">Markets</h2>
            {markets.length === 0 && (
              <div className="rounded-2xl border border-dashed border-pitch-600 p-6 text-center text-sm text-ink-500">
                No on-chain markets for this fixture yet.
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              {markets.map((m) => (
                <MarketCard key={m.address} market={m} homeName={fixture?.home} awayName={fixture?.away} />
              ))}
            </div>
          </section>

          {/* Consensus odds */}
          <section className="rounded-2xl border border-pitch-700 bg-pitch-900 p-4">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold">TxLINE consensus odds — implied probability</h2>
              <span className="text-xs text-ink-500">{odds?.superOddsType ?? ""}</span>
            </div>
            {oddsProbs ? (
              <ProbBars
                labels={[fixture?.home ?? "Home", "Draw", fixture?.away ?? "Away"]}
                probs={oddsProbs}
                colors={SERIES}
              />
            ) : (
              <p className="text-xs text-ink-500">No odds stream for this fixture yet.</p>
            )}
            {odds?.history && odds.history.length > 1 && (
              <div className="mt-4">
                <h3 className="mb-1 text-xs text-ink-500">Price movement (decimal odds)</h3>
                <OddsChart
                  history={odds.history}
                  names={[fixture?.home ?? "Home", "Draw", fixture?.away ?? "Away"]}
                />
              </div>
            )}
          </section>
        </div>

        {/* Event timeline */}
        <aside className="rounded-2xl border border-pitch-700 bg-pitch-900 p-4">
          <h2 className="mb-3 text-sm font-semibold">Match feed</h2>
          <div className="max-h-[560px] space-y-2 overflow-y-auto pr-1">
            {(live?.events ?? []).slice().reverse().map((e) => (
              <div key={`${e.seq}-${e.action}`} className="flex items-start gap-2 rounded-lg bg-pitch-800 px-3 py-2 text-xs">
                <span>{ACTION_ICONS[e.action] ?? "·"}</span>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{e.action.replace(/_/g, " ")}</span>
                    {e.minutes != null && <span className="mono text-ink-500">{e.minutes}′</span>}
                    {e.participant === 1 && <span className="text-ink-500">{fixture?.home}</span>}
                    {e.participant === 2 && <span className="text-ink-500">{fixture?.away}</span>}
                  </div>
                </div>
                <span className="mono ml-auto shrink-0 text-ink-500">#{e.seq}</span>
              </div>
            ))}
            {(!live || live.events.length === 0) && (
              <p className="text-xs text-ink-500">No events yet. This panel fills in real time from the TxLINE scores stream.</p>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
