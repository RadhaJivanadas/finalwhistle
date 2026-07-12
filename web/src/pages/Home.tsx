import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { fetchFixtures, fetchMarkets, subscribe, useLiveMap } from "../lib/api";
import type { FixtureInfo, MarketInfo } from "../lib/types";
import { fmtTime } from "../lib/format";

export function HomePage() {
  const [fixtures, setFixtures] = useState<FixtureInfo[]>([]);
  const [markets, setMarkets] = useState<MarketInfo[]>([]);
  const live = useLiveMap();

  useEffect(() => {
    fetchFixtures().then(setFixtures).catch(() => {});
    fetchMarkets().then(setMarkets).catch(() => {});
    const un1 = subscribe("fixtures", setFixtures);
    const un2 = subscribe("settled", () => fetchMarkets().then(setMarkets).catch(() => {}));
    const t = setInterval(() => fetchMarkets().then(setMarkets).catch(() => {}), 30000);
    return () => { un1(); un2(); clearInterval(t); };
  }, []);

  const marketsByFixture = useMemo(() => {
    const m = new Map<number, MarketInfo[]>();
    for (const mk of markets) {
      if (!m.has(mk.fixtureId)) m.set(mk.fixtureId, []);
      m.get(mk.fixtureId)!.push(mk);
    }
    return m;
  }, [markets]);

  const withMarkets = useMemo(() => {
    const ids = new Set(markets.map((m) => m.fixtureId));
    const known = fixtures.filter((f) => ids.has(f.fixtureId) || live.has(f.fixtureId));
    const rest = fixtures.filter((f) => !ids.has(f.fixtureId) && !live.has(f.fixtureId));
    const liveFirst = (a: FixtureInfo, b: FixtureInfo) => {
      const la = live.get(a.fixtureId)?.finalised === false ? 1 : 0;
      const lb = live.get(b.fixtureId)?.finalised === false ? 1 : 0;
      return lb - la || a.startTime - b.startTime;
    };
    return { known: known.sort(liveFirst), rest: rest.sort((a, b) => a.startTime - b.startTime) };
  }, [fixtures, markets, live]);

  return (
    <div className="space-y-8">
      <section className="rounded-3xl border border-pitch-700 bg-gradient-to-br from-pitch-800 to-pitch-900 p-8">
        <h1 className="max-w-2xl text-3xl font-bold leading-tight tracking-tight">
          Prediction markets that settle themselves the second the whistle blows.
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink-300">
          Stakes live in a Solana escrow no one controls. When a match is finalised, anyone can submit
          TxLINE&apos;s cryptographic Merkle proof — the escrow verifies it <em>on-chain</em> against
          TxODDS&apos;s anchored roots and pays winners instantly. No oracle committee. No admin key. No trust.
        </p>
        <div className="mt-4 flex flex-wrap gap-2 text-xs text-ink-500">
          {["Parimutuel pools in SOL", "CPI → validate_stat_v2", "Verifiable receipts", "Permissionless settlement"].map((t) => (
            <span key={t} className="rounded-full border border-pitch-600 px-3 py-1">{t}</span>
          ))}
        </div>
      </section>

      <Section title="Markets" subtitle="Fixtures with open or settled pools">
        {withMarkets.known.length === 0 && <Empty text="No markets yet — the keeper opens them automatically as fixtures appear." />}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {withMarkets.known.map((f) => (
            <FixtureCard key={f.fixtureId} f={f} live={live.get(f.fixtureId)} markets={marketsByFixture.get(f.fixtureId) ?? []} />
          ))}
        </div>
      </Section>

      <Section title="Upcoming coverage" subtitle="From the TxLINE fixtures feed">
        {withMarkets.rest.length === 0 && <Empty text="Waiting for the fixtures feed…" />}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {withMarkets.rest.slice(0, 12).map((f) => (
            <FixtureCard key={f.fixtureId} f={f} markets={[]} />
          ))}
        </div>
      </Section>
    </div>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-3">
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="text-xs text-ink-500">{subtitle}</p>
      </div>
      {children}
    </section>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="rounded-2xl border border-dashed border-pitch-600 p-6 text-center text-sm text-ink-500">{text}</div>;
}

function FixtureCard({ f, live, markets }: { f: FixtureInfo; live?: any; markets: MarketInfo[] }) {
  const isLive = live && !live.finalised && (live.seq ?? 0) > 0;
  const done = live?.finalised;
  const settled = markets.filter((m) => m.state === "settled").length;
  return (
    <Link
      to={`/match/${f.fixtureId}`}
      className="group rounded-2xl border border-pitch-700 bg-pitch-900 p-4 transition-colors hover:border-ink-500"
    >
      <div className="flex items-center justify-between text-xs text-ink-500">
        <span className="truncate">{f.competition || "—"}</span>
        {isLive ? (
          <span className="flex items-center gap-1.5 font-medium text-bad">
            <span className="live-dot inline-block h-2 w-2 rounded-full bg-bad" /> LIVE {live.minutes ? `${live.minutes}′` : ""}
          </span>
        ) : done ? (
          <span className="text-good">FT</span>
        ) : (
          <span>{fmtTime(f.startTime)}</span>
        )}
      </div>
      <div className="mt-2 space-y-1">
        <TeamRow name={f.home} score={live?.homeGoals} />
        <TeamRow name={f.away} score={live?.awayGoals} />
      </div>
      <div className="mt-3 flex items-center justify-between text-xs">
        <span className="text-ink-500">
          {markets.length ? `${markets.length} market${markets.length > 1 ? "s" : ""}` : "no markets"}
          {settled ? ` · ${settled} settled ✓` : ""}
        </span>
        <span className="text-ink-500 transition-colors group-hover:text-ink-100">→</span>
      </div>
    </Link>
  );
}

function TeamRow({ name, score }: { name: string; score?: number }) {
  return (
    <div className="flex items-center justify-between">
      <span className="truncate text-sm font-medium">{name}</span>
      <span className="mono text-sm">{score ?? ""}</span>
    </div>
  );
}
