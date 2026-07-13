/**
 * TxLINE API client: guest-JWT lifecycle, authenticated REST calls and
 * auto-reconnecting SSE streams for scores and odds.
 *
 * Endpoints used (devnet host by default):
 *   POST /auth/guest/start
 *   GET  /api/fixtures/snapshot
 *   GET  /api/scores/snapshot/{fixtureId}
 *   GET  /api/scores/historical/{fixtureId}
 *   GET  /api/scores/stream                (SSE)
 *   GET  /api/odds/stream                  (SSE)
 *   GET  /api/odds/snapshot/{fixtureId}
 *   GET  /api/scores/stat-validation       (Merkle proofs for settlement)
 */
import axios, { AxiosInstance } from "axios";
import { config } from "./config.js";

let jwt = "";

export async function renewJwt(): Promise<string> {
  const res = await axios.post(`${config.txlineHost}/auth/guest/start`);
  jwt = res.data.token;
  return jwt;
}

export const api: AxiosInstance = axios.create({
  baseURL: config.txlineHost,
  timeout: 30000,
});

api.interceptors.request.use(async (req) => {
  if (!jwt) await renewJwt();
  req.headers["Authorization"] = `Bearer ${jwt}`;
  req.headers["X-Api-Token"] = config.txlineApiToken;
  return req;
});

api.interceptors.response.use(
  (r) => r,
  async (error) => {
    const original = error.config;
    if (error.response?.status === 401 && !original._retry) {
      original._retry = true;
      await renewJwt();
      return api(original);
    }
    throw error;
  }
);

// ---------------------------------------------------------------------------
// SSE
// ---------------------------------------------------------------------------

export type SseMessage = { id?: string; event?: string; data: string };

function parseSseBlock(block: string): SseMessage | null {
  const message: SseMessage = { data: "" };
  for (const rawLine of block.split(/\r?\n/)) {
    if (!rawLine || rawLine.startsWith(":")) continue;
    const sep = rawLine.indexOf(":");
    const field = sep === -1 ? rawLine : rawLine.slice(0, sep);
    const value = sep === -1 ? "" : rawLine.slice(sep + 1).replace(/^ /, "");
    if (field === "data") message.data += `${value}\n`;
    if (field === "event") message.event = value;
    if (field === "id") message.id = value;
  }
  message.data = message.data.replace(/\n$/, "");
  return message.data || message.event || message.id ? message : null;
}

async function* readSse(response: Response): AsyncGenerator<SseMessage> {
  if (!response.body) throw new Error("SSE response has no body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let sep = buffer.match(/\r?\n\r?\n/);
      while (sep?.index !== undefined) {
        const block = buffer.slice(0, sep.index);
        buffer = buffer.slice(sep.index + sep[0].length);
        const msg = parseSseBlock(block);
        if (msg) yield msg;
        sep = buffer.match(/\r?\n\r?\n/);
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Consume a TxLINE SSE stream forever, invoking `onMessage` per event.
 * Reconnects with backoff on any error; renews the JWT on 401.
 */
export async function streamForever(
  path: "/api/scores/stream" | "/api/odds/stream",
  onMessage: (event: string | undefined, data: unknown) => void,
  label: string
): Promise<never> {
  let backoff = 1000;
  while (true) {
    try {
      if (!jwt) await renewJwt();
      const res = await fetch(`${config.txlineHost}${path}`, {
        headers: {
          Authorization: `Bearer ${jwt}`,
          "X-Api-Token": config.txlineApiToken,
          Accept: "text/event-stream",
          "Cache-Control": "no-cache",
        },
      });
      if (res.status === 401) {
        await renewJwt();
        continue;
      }
      if (!res.ok) throw new Error(`${label} stream HTTP ${res.status}`);
      console.log(`[txline] ${label} stream connected`);
      backoff = 1000;
      for await (const msg of readSse(res)) {
        let data: unknown = msg.data;
        try {
          data = JSON.parse(msg.data);
        } catch {
          /* heartbeats / non-JSON frames pass through as strings */
        }
        onMessage(msg.event, data);
      }
      console.warn(`[txline] ${label} stream ended; reconnecting`);
    } catch (e: any) {
      console.warn(`[txline] ${label} stream error: ${e.message}; retry in ${backoff}ms`);
      await new Promise((r) => setTimeout(r, backoff));
      backoff = Math.min(backoff * 2, 30000);
    }
  }
}

// ---------------------------------------------------------------------------
// REST helpers
// ---------------------------------------------------------------------------

export async function fetchFixtures(): Promise<any[]> {
  const res = await api.get("/api/fixtures/snapshot");
  return res.data ?? [];
}

export async function fetchScoresSnapshot(fixtureId: number): Promise<any[]> {
  const res = await api.get(`/api/scores/snapshot/${fixtureId}?asOf=${Date.now()}`);
  return res.data ?? [];
}

/** `/api/scores/historical` streams SSE-formatted text (`data: {...}` blocks)
 *  even over a plain GET — parse it into an array of records. */
export async function fetchHistoricalScores(fixtureId: number): Promise<any[]> {
  const res = await api.get(`/api/scores/historical/${fixtureId}`, {
    responseType: "text",
    transformResponse: [(d) => d],
  });
  const body: string = res.data ?? "";
  if (body.trimStart().startsWith("[")) return JSON.parse(body); // just in case
  const records: any[] = [];
  for (const line of body.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    try {
      records.push(JSON.parse(line.slice(5).trim()));
    } catch {
      /* skip malformed frame */
    }
  }
  return records;
}

export async function fetchOddsSnapshot(fixtureId: number): Promise<any[]> {
  const res = await api.get(`/api/odds/snapshot/${fixtureId}`);
  return res.data ?? [];
}

/** Merkle proof for a set of stats of one score record (validateStatV2 shape). */
export async function fetchStatValidation(
  fixtureId: number,
  seq: number,
  statKeys: number[]
): Promise<any> {
  const res = await api.get("/api/scores/stat-validation", {
    params: { fixtureId, seq, statKeys: statKeys.join(",") },
  });
  return res.data;
}
