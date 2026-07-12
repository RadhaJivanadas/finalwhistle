import { useState } from "react";
import { Link } from "react-router-dom";
import { useAnchorWallet, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import type { MarketInfo } from "../lib/types";
import { OUTCOME_LABELS, marketTitle } from "../lib/types";
import { fmtSol, impliedOdds, impliedProb } from "../lib/format";
import { placeBet } from "../lib/anchor";
import { ProbBars, SERIES } from "./charts";

export function MarketCard({
  market,
  homeName,
  awayName,
  onBetPlaced,
}: {
  market: MarketInfo;
  homeName?: string;
  awayName?: string;
  onBetPlaced?: () => void;
}) {
  const wallet = useAnchorWallet();
  const { connected } = useWallet();
  const { setVisible } = useWalletModal();
  const [selected, setSelected] = useState<number | null>(null);
  const [amount, setAmount] = useState("0.1");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const n = market.kind === "winner" ? 3 : 2;
  const labels =
    market.kind === "winner"
      ? [homeName ?? "Home", "Draw", awayName ?? "Away"]
      : [`Over ${market.line}.5`, `Under ${market.line}.5`];
  const colors = market.kind === "winner" ? SERIES : [SERIES[0], SERIES[2]];
  const bettingOpen = market.state === "open" && Date.now() / 1000 < market.kickoffTs;

  async function submit() {
    if (!wallet) return setVisible(true);
    if (selected == null) return;
    setBusy(true);
    setStatus(null);
    try {
      const sig = await placeBet(wallet, market.address, selected, Math.round(Number(amount) * 1e9));
      setStatus({ kind: "ok", text: `Bet placed · tx ${sig.slice(0, 8)}…` });
      onBetPlaced?.();
    } catch (e: any) {
      setStatus({ kind: "err", text: e.message?.slice(0, 120) ?? "failed" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-pitch-700 bg-pitch-900 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold">{marketTitle(market)}</h3>
        <StateBadge market={market} />
      </div>

      <ProbBars
        labels={labels}
        probs={Array.from({ length: n }, (_, i) => impliedProb(market.pools, i))}
        colors={colors}
      />

      {bettingOpen && (
        <div className="mt-4 space-y-2">
          <div className="flex gap-1.5">
            {labels.map((label, i) => {
              const odds = impliedOdds(market.pools, i);
              return (
                <button
                  key={label}
                  onClick={() => setSelected(i)}
                  className={`flex-1 rounded-xl border px-2 py-2 text-xs transition-colors ${
                    selected === i
                      ? "border-ink-100 bg-pitch-600"
                      : "border-pitch-600 bg-pitch-800 hover:border-ink-500"
                  }`}
                >
                  <div className="font-medium">{label}</div>
                  <div className="mono mt-0.5 text-ink-500">{odds ? `${odds.toFixed(2)}×` : "first bet"}</div>
                </button>
              );
            })}
          </div>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                inputMode="decimal"
                className="mono w-full rounded-xl border border-pitch-600 bg-pitch-800 px-3 py-2 text-sm outline-none focus:border-ink-500"
              />
              <span className="absolute right-3 top-2 text-xs text-ink-500">SOL</span>
            </div>
            <button
              onClick={submit}
              disabled={busy || selected == null || !(Number(amount) > 0)}
              className="rounded-xl bg-ink-100 px-4 py-2 text-sm font-semibold text-pitch-950 transition-opacity disabled:opacity-40"
            >
              {busy ? "Signing…" : connected ? "Place bet" : "Connect"}
            </button>
          </div>
          {status && (
            <p className={`text-xs ${status.kind === "ok" ? "text-good" : "text-bad"}`}>{status.text}</p>
          )}
        </div>
      )}

      <div className="mt-3 flex items-center justify-between text-xs text-ink-500">
        <span className="mono">pool {fmtSol(market.pools.reduce((a, p) => a + Number(p), 0))}</span>
        {market.state === "settled" && (
          <Link to={`/receipt/${market.address}`} className="text-good underline-offset-2 hover:underline">
            ✓ Proof receipt →
          </Link>
        )}
      </div>
    </div>
  );
}

function StateBadge({ market }: { market: MarketInfo }) {
  if (market.state === "settled") {
    const label = OUTCOME_LABELS[market.kind][market.winningOutcome];
    return (
      <span className="rounded-full bg-good/15 px-2.5 py-0.5 text-xs font-medium text-good">
        ✓ Settled · {label}
      </span>
    );
  }
  if (market.state === "void")
    return <span className="rounded-full bg-pitch-600 px-2.5 py-0.5 text-xs text-ink-300">Void · refunds open</span>;
  const open = Date.now() / 1000 < market.kickoffTs;
  return open ? (
    <span className="rounded-full bg-home/15 px-2.5 py-0.5 text-xs font-medium" style={{ color: "var(--color-home)" }}>
      Betting open
    </span>
  ) : (
    <span className="rounded-full bg-draw/15 px-2.5 py-0.5 text-xs font-medium" style={{ color: "var(--color-draw)" }}>
      In play — awaiting proof
    </span>
  );
}
