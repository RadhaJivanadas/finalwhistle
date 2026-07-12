import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAnchorWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { fetchMarkets, fetchFixtures } from "../lib/api";
import { claim, fetchPositions } from "../lib/anchor";
import type { FixtureInfo, MarketInfo } from "../lib/types";
import { OUTCOME_LABELS, marketTitle } from "../lib/types";
import { fmtSol, shortAddr } from "../lib/format";

interface Row {
  address: string;
  market: string;
  outcome: number;
  amount: string;
  marketInfo?: MarketInfo;
  fixture?: FixtureInfo;
}

export function PortfolioPage() {
  const wallet = useAnchorWallet();
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!wallet) return;
    const [positions, markets, fixtures] = await Promise.all([
      fetchPositions(wallet),
      fetchMarkets().catch(() => [] as MarketInfo[]),
      fetchFixtures().catch(() => [] as FixtureInfo[]),
    ]);
    setRows(
      positions.map((p: any) => {
        const marketInfo = markets.find((m) => m.address === p.market);
        return {
          ...p,
          marketInfo,
          fixture: fixtures.find((f) => f.fixtureId === marketInfo?.fixtureId),
        };
      })
    );
  }, [wallet]);

  useEffect(() => { load().catch(() => {}); }, [load]);

  async function doClaim(row: Row) {
    if (!wallet) return;
    setBusy(row.address);
    setMsg(null);
    try {
      const sig = await claim(wallet, row.market, row.outcome);
      setMsg(`Claimed · tx ${sig.slice(0, 10)}…`);
      await load();
    } catch (e: any) {
      setMsg(`Claim failed: ${e.message?.slice(0, 140)}`);
    } finally {
      setBusy(null);
    }
  }

  if (!wallet) {
    return (
      <div className="mx-auto max-w-md rounded-3xl border border-pitch-700 bg-pitch-900 p-10 text-center">
        <p className="mb-4 text-sm text-ink-300">Connect a devnet wallet to see your positions.</p>
        <div className="flex justify-center"><WalletMultiButton /></div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">My bets</h1>
      {msg && <p className="text-xs text-ink-300">{msg}</p>}
      {rows.length === 0 && (
        <div className="rounded-2xl border border-dashed border-pitch-600 p-6 text-center text-sm text-ink-500">
          No positions yet. Pick a match and place a bet.
        </div>
      )}
      <div className="space-y-2">
        {rows.map((r) => {
          const m = r.marketInfo;
          const outcomeLabel = m
            ? m.kind === "winner"
              ? [r.fixture?.home ?? "Home", "Draw", r.fixture?.away ?? "Away"][r.outcome]
              : OUTCOME_LABELS[m.kind][r.outcome]
            : `#${r.outcome}`;
          const won = m?.state === "settled" && m.winningOutcome === r.outcome;
          const voided = m?.state === "void";
          const lost = m?.state === "settled" && m.winningOutcome !== r.outcome;
          return (
            <div key={r.address} className="flex flex-wrap items-center gap-3 rounded-2xl border border-pitch-700 bg-pitch-900 px-4 py-3 text-sm">
              <div className="min-w-0 flex-1">
                <div className="font-medium">
                  {r.fixture ? `${r.fixture.home} vs ${r.fixture.away}` : shortAddr(r.market)}
                </div>
                <div className="text-xs text-ink-500">
                  {m ? marketTitle(m) : "market"} · your pick: <span className="text-ink-300">{outcomeLabel}</span>
                </div>
              </div>
              <span className="mono">{fmtSol(r.amount)}</span>
              {won && (
                <button
                  onClick={() => doClaim(r)}
                  disabled={busy === r.address}
                  className="rounded-xl bg-good px-3 py-1.5 text-xs font-semibold text-pitch-950 disabled:opacity-50"
                >
                  {busy === r.address ? "Claiming…" : "Claim winnings"}
                </button>
              )}
              {voided && (
                <button
                  onClick={() => doClaim(r)}
                  disabled={busy === r.address}
                  className="rounded-xl bg-pitch-600 px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
                >
                  Reclaim stake
                </button>
              )}
              {lost && <span className="text-xs text-ink-500">lost</span>}
              {m?.state === "open" && <span className="text-xs text-ink-500">open</span>}
              {m?.state === "settled" && (
                <Link to={`/receipt/${r.market}`} className="text-xs text-home underline-offset-2 hover:underline">
                  proof →
                </Link>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
