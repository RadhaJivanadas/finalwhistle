/**
 * Settlement receipt: the full, independently verifiable evidence chain for a
 * market's outcome — the Merkle path from the stat leaves to the daily root
 * anchored on Solana, the predicate that was proven, and a one-click
 * re-verification that runs `validate_stat_v2` from THIS browser.
 */
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { fetchReceipt } from "../lib/api";
import type { SettlementReceipt } from "../lib/types";
import { verifyReceiptInBrowser } from "../lib/anchor";
import { explorerAddr, explorerTx, shortAddr } from "../lib/format";

export function ReceiptPage() {
  const { market } = useParams();
  const [receipt, setReceipt] = useState<SettlementReceipt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [verify, setVerify] = useState<{ state: "idle" | "running" | "ok" | "fail"; detail?: string }>({ state: "idle" });

  useEffect(() => {
    if (market) fetchReceipt(market).then(setReceipt).catch((e) => setError(e.message));
  }, [market]);

  async function runVerify() {
    if (!receipt) return;
    setVerify({ state: "running" });
    try {
      const ok = await verifyReceiptInBrowser(receipt);
      setVerify({ state: ok ? "ok" : "fail" });
    } catch (e: any) {
      setVerify({ state: "fail", detail: e.message?.slice(0, 200) });
    }
  }

  if (error) return <p className="text-sm text-bad">No receipt found for this market ({error}).</p>;
  if (!receipt) return <p className="text-sm text-ink-500">Loading receipt…</p>;

  const v = receipt.proof;
  const stats = v.statsToProve ?? [];
  const pred = receipt.strategy?.discretePredicates?.[0]?.binary;
  const opTxt = pred?.op?.add ? "+" : "−";
  const cmp = pred?.predicate?.comparison;
  const cmpTxt = cmp?.greaterThan ? ">" : cmp?.lessThan ? "<" : "=";

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <header>
        <div className="text-xs text-ink-500">Settlement receipt · market {shortAddr(receipt.market, 6)}</div>
        <h1 className="mt-1 text-2xl font-bold">
          <span className="text-good">✓ {receipt.outcomeLabel}</span> — proven on-chain
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-300">
          This market was not settled by us, an admin, or a multisig. It was settled by a Solana
          transaction that handed TxLINE&apos;s Merkle proof to the TxODDS oracle program and required
          it to return <span className="mono">true</span>. Every step below is public and repeatable.
        </p>
      </header>

      {/* Step chain */}
      <ol className="space-y-3">
        <Step n={1} title="Finalised match record">
          Score record <span className="mono">seq {receipt.seq}</span> of fixture{" "}
          <span className="mono">{receipt.fixtureId}</span>, flagged <span className="mono">game_finalised (period 100)</span>.
          The proven stats:
          <div className="mt-2 flex flex-wrap gap-2">
            {stats.map((s: any, i: number) => (
              <span key={i} className="mono rounded-lg bg-pitch-800 px-2.5 py-1 text-xs">
                key {s.key} → value {s.value} (period {s.period})
              </span>
            ))}
          </div>
        </Step>

        <Step n={2} title="The predicate that was proven">
          <span className="mono rounded-lg bg-pitch-800 px-2.5 py-1 text-xs">
            stat[{pred?.indexA}] {opTxt} stat[{pred?.indexB}] {cmpTxt} {pred?.predicate?.threshold}
          </span>
          <span className="ml-2 text-xs text-ink-500">
            (built deterministically by the escrow program from the market&apos;s parameters — the caller cannot choose it)
          </span>
        </Step>

        <Step n={3} title="Merkle path to the anchored root">
          <ProofStats label="stat proofs" nodes={(v.statProofs ?? []).flat().length} />
          <ProofStats label="fixture sub-tree" nodes={(v.subTreeProof ?? []).length} />
          <ProofStats label="main tree" nodes={(v.mainTreeProof ?? []).length} />
          <div className="mt-2 text-xs text-ink-300">
            Root account (TxLINE PDA, epoch day {receipt.epochDay}):{" "}
            <a className="mono text-home underline-offset-2 hover:underline" href={explorerAddr(receipt.dailyScoresPda)} target="_blank" rel="noreferrer">
              {shortAddr(receipt.dailyScoresPda, 6)}
            </a>
          </div>
        </Step>

        <Step n={4} title="Settlement transaction">
          <a className="mono text-xs text-home underline-offset-2 hover:underline" href={explorerTx(receipt.txSignature)} target="_blank" rel="noreferrer">
            {receipt.txSignature}
          </a>
          <div className="mt-1 text-xs text-ink-500">
            escrow <span className="mono">settle</span> → CPI <span className="mono">txoracle.validate_stat_v2</span> → returned{" "}
            <span className="mono">true</span> → pools unlocked
          </div>
        </Step>
      </ol>

      {/* Re-verify */}
      <section className="rounded-2xl border border-pitch-700 bg-pitch-900 p-5">
        <h2 className="text-sm font-semibold">Don&apos;t trust us — re-verify right now</h2>
        <p className="mt-1 text-xs leading-relaxed text-ink-500">
          Your browser will submit the same proof and predicate to the TxLINE oracle program as a
          read-only simulation against Solana devnet, and show you the oracle&apos;s verdict. No wallet needed.
        </p>
        <div className="mt-3 flex items-center gap-3">
          <button
            onClick={runVerify}
            disabled={verify.state === "running"}
            className="rounded-xl bg-ink-100 px-4 py-2 text-sm font-semibold text-pitch-950 disabled:opacity-50"
          >
            {verify.state === "running" ? "Asking the oracle…" : "Verify in my browser"}
          </button>
          {verify.state === "ok" && <span className="text-sm font-medium text-good">✓ Oracle returned true — outcome verified</span>}
          {verify.state === "fail" && (
            <span className="text-sm font-medium text-bad">✗ Verification failed{verify.detail ? ` — ${verify.detail}` : ""}</span>
          )}
        </div>
      </section>

      <details className="rounded-2xl border border-pitch-700 bg-pitch-900 p-5 text-xs">
        <summary className="cursor-pointer text-sm font-semibold">Raw proof payload (from /api/scores/stat-validation)</summary>
        <pre className="mt-3 max-h-96 overflow-auto rounded-lg bg-pitch-950 p-3 text-[10px] leading-relaxed text-ink-300">
          {JSON.stringify(receipt.proof, null, 2)}
        </pre>
      </details>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="rounded-2xl border border-pitch-700 bg-pitch-900 p-5">
      <div className="flex items-center gap-3">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-pitch-600 text-xs font-bold">{n}</span>
        <h2 className="text-sm font-semibold">{title}</h2>
      </div>
      <div className="mt-2 pl-9 text-sm text-ink-300">{children}</div>
    </li>
  );
}

function ProofStats({ label, nodes }: { label: string; nodes: number }) {
  return (
    <span className="mono mr-2 inline-block rounded-lg bg-pitch-800 px-2.5 py-1 text-xs">
      {label}: {nodes} hashes
    </span>
  );
}
