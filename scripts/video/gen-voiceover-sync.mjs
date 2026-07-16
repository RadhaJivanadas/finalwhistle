// Per-caption narration for exact subtitle sync (Gemini-TTS).
//   GEMINI_API_KEY=... node scripts/video/gen-voiceover-sync.mjs [outDir]
// Writes vo/<scene>-p<i>.wav — one phrase per on-screen caption.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.argv[2] || path.join(__dirname, "vo");
const KEY = process.env.GEMINI_API_KEY;
if (!KEY) { console.error("GEMINI_API_KEY required"); process.exit(1); }
fs.mkdirSync(OUT, { recursive: true });

const MODELS = ["gemini-3.1-flash-tts-preview", "gemini-2.5-pro-preview-tts"];
const VOICE = process.env.TTS_VOICE || "Charon";
const FFMPEG = "C:/Programs/ffmpeg/bin/ffmpeg.exe";

const DIRECTOR = `You are the narrator of a 3-minute product demo video for "Final Whistle" — a World Cup prediction market on Solana that settles itself with cryptographic proofs.
Audio profile: a confident male documentary narrator with the energy of a top-tier sports broadcast — think champions-league opening sequence meets a fintech keynote. Natural pace, crisp diction, American English.
Scene: dark, sleek product UI on screen; a real World Cup semifinal is being played as you speak.
Director's notes: this is ONE short line from the middle of the film — deliver it as a continuation, not an opening; follow the inline [bracket] cues precisely; keep energy high but never shouty; land technical terms with clarity and weight. Do not read the bracket tags aloud. Do not add any words that are not in the transcript.
Read aloud ONLY the transcript below:

TRANSCRIPT: `;

const PHRASES = {
  "01-home": [
    `This is Final Whistle — prediction markets for the World Cup, running live on Solana.`,
    `Every fixture here comes straight from the TxLINE data feed... including tonight's semifinal, France against Spain — [excited] live, right now.`,
    `Our keeper opens on-chain markets for every covered match. [confident] Automatically.`,
  ],
  "02-bet": [
    `Here's tomorrow's semifinal — England against Argentina. Betting stays open until kickoff.`,
    `[interested] And real stakes are landing on-chain right now... one bet. Two. Three.`,
    `There they are. The odds are simply the pool ratio — parimutuel. No market maker, no order book.`,
    `[serious] At kickoff the program stops accepting stakes. From then on, only a cryptographic proof can move this money.`,
  ],
  "03-live": [
    `[energetic] And here it is — the semifinal, live. France. Spain. The score and every event, streaming straight from TxLINE.`,
    `Corners, cards, possession — the exact raw data that will settle these markets. Cryptographically.`,
    `[serious] While the match runs, the escrow holds every stake. Nobody — not even us — can touch it.`,
  ],
  "04-settle": [
    `The final minutes of the semifinal. When the referee blows the whistle, TxLINE publishes a finalised record, anchored to a Merkle root on Solana. And then — with zero human input — [building anticipation] watch this.`,
    `[excited] Settled! Seconds after full time. The escrow verified TxLINE's Merkle proof on-chain, via CPI, before releasing a single lamport.`,
    `[confident] A wrong outcome can't be claimed — the proof itself would refute it. A forged proof fails the anchored Merkle root.`,
  ],
  "05-receipt": [
    `Every settlement gets a public receipt. The finalised stats. The exact predicate proven. The Merkle path. The transaction.`,
    `[intrigued] And you don't have to trust any of it. Watch.`,
    `The browser itself re-submits the proof to the TxLINE oracle program — a read-only simulation, live on devnet.`,
    `[satisfied] And the oracle says: true. A real World Cup semifinal — settled by cryptography alone.`,
  ],
};

async function tts(model, text) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: DIRECTOR + text }] }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE } } },
        },
      }),
    }
  );
  if (!res.ok) throw new Error(`${model} HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const part = data.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
  if (!part) throw new Error(`no audio in response: ${JSON.stringify(data).slice(0, 200)}`);
  return { b64: part.inlineData.data, mime: part.inlineData.mimeType };
}

for (const [scene, phrases] of Object.entries(PHRASES)) {
  for (let i = 0; i < phrases.length; i++) {
    const name = `${scene}-p${i}`;
    const wav = path.join(OUT, `${name}.wav`);
    if (fs.existsSync(wav) && !process.env.FORCE) { console.log(`${name}: exists, skip`); continue; }
    let done = false;
    for (const model of MODELS) {
      for (let attempt = 1; attempt <= 3 && !done; attempt++) {
        try {
          const { b64, mime } = await tts(model, phrases[i]);
          const raw = path.join(OUT, `${name}.raw`);
          fs.writeFileSync(raw, Buffer.from(b64, "base64"));
          const rate = /rate=(\d+)/.exec(mime)?.[1] ?? "24000";
          execFileSync(FFMPEG, ["-y", "-loglevel", "error", "-f", "s16le", "-ar", rate, "-ac", "1",
            "-i", raw, wav]);
          fs.unlinkSync(raw);
          console.log(`${name}: OK (${model})`);
          done = true;
        } catch (e) {
          console.warn(`${name}: ${model} attempt ${attempt}: ${e.message}`);
          await new Promise((r) => setTimeout(r, 3000 * attempt));
        }
      }
      if (done) break;
    }
    if (!done) { console.error(`FAILED: ${name}`); process.exit(1); }
  }
}
console.log("all phrases generated in", OUT);
