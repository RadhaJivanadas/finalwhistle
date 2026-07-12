import { Link, Outlet, useLocation } from "react-router-dom";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";

export function Layout() {
  const { pathname } = useLocation();
  const nav = [
    { to: "/", label: "Matches" },
    { to: "/portfolio", label: "My bets" },
  ];
  return (
    <div className="min-h-screen bg-pitch-950 text-ink-100">
      <header className="sticky top-0 z-40 border-b border-pitch-700 bg-pitch-950/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3">
          <Link to="/" className="flex items-center gap-2 text-lg font-bold tracking-tight">
            <span aria-hidden>🏁</span> Final Whistle
          </Link>
          <nav className="flex gap-1 text-sm">
            {nav.map((n) => (
              <Link
                key={n.to}
                to={n.to}
                className={`rounded-lg px-3 py-1.5 transition-colors ${
                  pathname === n.to ? "bg-pitch-700 text-ink-100" : "text-ink-500 hover:text-ink-100"
                }`}
              >
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden rounded-full border border-pitch-600 px-2.5 py-1 text-xs text-ink-500 sm:block">
              Solana devnet · TxLINE feed
            </span>
            <WalletMultiButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">
        <Outlet />
      </main>
      <footer className="mx-auto max-w-6xl px-4 py-8 text-xs text-ink-500">
        Markets settle on-chain via CPI into TxLINE&apos;s <span className="mono">validate_stat_v2</span> —
        no oracle committee, no admin key. Built for the TxODDS World Cup hackathon.
      </footer>
    </div>
  );
}
