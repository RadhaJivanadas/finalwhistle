// Generates the demo narration with Gemini-TTS (emotion-controlled).
//   GEMINI_API_KEY=... node scripts/video/gen-voiceover.mjs [outDir]
// Writes vo-<scene>.wav (24 kHz mono) per scene + prints durations.
//
// Prompting follows Google's "director" guidance for Gemini-TTS: an audio
// profile + scene vibe + directors notes, a clear synthesis preamble, and
// inline [emotion] tags in the transcript. Retries handle the occasional
// text-instead-of-audio 500s the docs warn about.
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
Director's notes: follow the inline [bracket] cues for emotional shifts precisely; keep energy high but never shouty; land technical terms ("Merkle proof", "on-chain", "CPI") with clarity and weight. Do not read the bracket tags aloud. Do not add any words that are not in the transcript.
Read aloud ONLY the transcript below:

TRANSCRIPT: `;

const SCENES = {
  "00-title":
    `[intrigued] What if a prediction market could settle itself... [excited] the second the referee blows the whistle?`,
  "01-home":
    `This is Final Whistle — prediction markets for the World Cup, running live on Solana. Every fixture on this screen comes straight from the TxLINE data feed... including tonight's semifinal, France against Spain — [excited] which is live, right now. Our keeper opens on-chain markets for every covered match. Automatically.`,
  "02-bet":
    `Here's tomorrow's semifinal — England against Argentina. Betting stays open until kickoff... and real stakes are landing on-chain as you watch. [interested] There — one bet... two... three. The odds are simply the pool ratio. Parimutuel: no market maker, no order book, no counterparty. [serious] And at kickoff, the program stops accepting stakes. From that moment on, only a cryptographic proof can move this money.`,
  "03-live":
    `[energetic] And here it is — the semifinal, live. France. Spain. The score, every corner, every card — streaming straight from TxLINE. This is the exact data that will settle these markets. [serious] While the match runs, the escrow holds every stake on-chain. Nobody — not the keeper, not an admin, not even us — can touch it.`,
  "04-settle":
    `The final minutes of the semifinal. When the referee blows the whistle, TxLINE publishes a finalised match record, anchored to a Merkle root on Solana. And then — with zero human input — [building anticipation] watch this. [excited] Settled! Seconds after full time. The escrow took nothing on trust: it verified TxLINE's Merkle proof on-chain, before releasing a single lamport. [confident] A wrong outcome simply cannot be claimed — the proof itself would refute it.`,
  "05-receipt":
    `Every settlement leaves a public receipt. The finalised stats. The exact predicate that was proven. The Merkle path to the anchored root. The transaction. [confident] But you don't have to trust any of it — your own browser can re-submit the proof to the TxLINE oracle, right now. [satisfied] And the oracle says: true. A real World Cup semifinal — settled by cryptography alone.`,
  "06-outro":
    `Final Whistle. No oracle committee. No admin key. [warm] No trust required.`,
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

for (const [scene, text] of Object.entries(SCENES)) {
  let done = false;
  for (const model of MODELS) {
    for (let attempt = 1; attempt <= 3 && !done; attempt++) {
      try {
        const { b64, mime } = await tts(model, text);
        const raw = path.join(OUT, `${scene}.raw`);
        fs.writeFileSync(raw, Buffer.from(b64, "base64"));
        // mime like audio/L16;codec=pcm;rate=24000
        const rate = /rate=(\d+)/.exec(mime)?.[1] ?? "24000";
        execFileSync(FFMPEG, ["-y", "-loglevel", "error", "-f", "s16le", "-ar", rate, "-ac", "1",
          "-i", raw, path.join(OUT, `vo-${scene}.wav`)]);
        fs.unlinkSync(raw);
        console.log(`${scene}: OK (${model}, ${mime})`);
        done = true;
      } catch (e) {
        console.warn(`${scene}: ${model} attempt ${attempt}: ${e.message}`);
        await new Promise((r) => setTimeout(r, 3000 * attempt));
      }
    }
    if (done) break;
  }
  if (!done) { console.error(`FAILED: ${scene}`); process.exit(1); }
}
console.log("all scenes generated in", OUT);
