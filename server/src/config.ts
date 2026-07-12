import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, "../..");

// Load .env.devnet (created by scripts/setup-devnet.mjs) then .env overrides.
for (const file of [".env.devnet", ".env"]) {
  const p = path.join(ROOT, file);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

export const config = {
  port: Number(process.env.PORT || 8787),
  txlineHost: process.env.TXLINE_API_HOST || "https://txline-dev.txodds.com",
  txlineApiToken: process.env.TXLINE_API_TOKEN || "",
  rpcUrl: process.env.RPC_URL || "https://api.devnet.solana.com",
  keeperKeypair: process.env.KEEPER_KEYPAIR || path.join(ROOT, ".keys", "keeper.json"),
  txoracleProgramId: process.env.TXORACLE_PROGRAM_ID || "6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J",
  finalwhistleProgramId: process.env.FINALWHISTLE_PROGRAM_ID || "3pqHn5WcqLpHRcZDP6FKTSez7VmjeDDzzuxb72FUoB3P",
  dataDir: process.env.DATA_DIR || path.join(ROOT, "data"),
  /// Competition name filters for auto market creation (empty = all fixtures).
  competitionFilter: (process.env.COMPETITION_FILTER || "world cup,friendl")
    .split(",").map(s => s.trim().toLowerCase()).filter(Boolean),
  /// Create markets automatically for upcoming fixtures.
  autoMarkets: process.env.AUTO_MARKETS !== "0",
  /// Default total-goals half line (2 = over/under 2.5).
  defaultGoalsLine: Number(process.env.DEFAULT_GOALS_LINE ?? 2),
};

fs.mkdirSync(config.dataDir, { recursive: true });
