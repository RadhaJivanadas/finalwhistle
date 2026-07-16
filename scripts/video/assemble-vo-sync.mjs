// Assembles the demo with PER-CAPTION sync: each scene is split at its
// caption-change timestamps; every segment is stretched (freeze-frame) or
// trimmed so its narration phrase fits while the caption is on screen.
//   node scripts/video/assemble-vo-sync.mjs
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(__dirname, "out-live");
const VO = path.join(__dirname, "vo");
const TMP = path.join(DIR, "sync-tmp");
const FF = "C:/Programs/ffmpeg/bin/ffmpeg.exe";
const FP = "C:/Programs/ffmpeg/bin/ffprobe.exe";
fs.mkdirSync(TMP, { recursive: true });

const dur = (f) => Number(execFileSync(FP, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).toString().trim());
const src = (s) => [".webm", ".mp4"].map((e) => path.join(DIR, s + e)).find(fs.existsSync);
const wav = (n) => path.join(VO, `${n}.wav`);

// Caption-change timestamps measured on the trimmed scene files.
// a: narration wav name(s) for the segment; mode:
//   auto (default) — trim segment tail to audio+2s, or freeze-extend if audio longer
//   full           — keep whole segment (essential visuals inside), freeze only if audio longer
//   keepEnd        — like auto but cut the segment HEAD (essential action at its end)
const SCENES = {
  "01-home": { cuts: [3.28, 13.4, 19.04], segs: [
    { a: "01-home-p0" }, { a: "01-home-p1" }, { a: "01-home-p2" }, {} ] },
  "02-bet": { cuts: [1.2, 31.12, 37.08, 43.12], segs: [
    {}, { a: ["02-bet-p0", "02-bet-p1"], mode: "keepEnd" }, { a: "02-bet-p2" }, { a: "02-bet-p3" }, {} ] },
  "03-live": { cuts: [15.12, 26.2, 32.2], segs: [
    { a: "03-live-p0" }, { a: "03-live-p1" }, { a: "03-live-p2" }, {} ] },
  "04-settle": { cuts: [37.04, 45.52, 52.04], segs: [
    { a: "04-settle-p0", mode: "keepEnd" }, { a: "04-settle-p1" }, { a: "04-settle-p2" }, {} ] },
  "05-receipt": { cuts: [1.6, 13.36, 22.72, 30.32, 36.28], segs: [
    {}, { a: "05-receipt-p0", mode: "full" }, { a: "05-receipt-p1" },
    { mode: "keepEnd", hold: 3.6 }, { a: "05-receipt-p2" }, {} ] },
};

const enc = ["-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
  "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "1", "-r", "25"];
const VCH = "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,fps=25";
const files = [];

function mergedWav(names) {
  if (!Array.isArray(names)) return wav(names);
  const out = path.join(TMP, names.join("+") + ".wav");
  if (!fs.existsSync(out)) {
    const inputs = names.flatMap((n) => ["-i", wav(n)]);
    // 0.45s pause between phrases
    execFileSync(FF, ["-y", "-loglevel", "error", ...inputs, "-filter_complex",
      `[0:a]apad=pad_dur=0.45[a0];[a0][1:a]concat=n=2:v=0:a=1[a]`, "-map", "[a]", out]);
  }
  return out;
}

// title & outro keep their single-file narration (skip first frames — white flash)
for (const s of ["00-title", "06-outro"]) {
  const v = src(s), a = wav(`vo-${s}`);
  const target = Math.max(dur(v) - 0.2, dur(a) + 0.7).toFixed(2);
  const out = path.join(TMP, `${s}.mp4`);
  execFileSync(FF, ["-y", "-loglevel", "error", "-i", v, "-i", a, "-filter_complex",
    `[0:v]trim=start=0.2,setpts=PTS-STARTPTS,${VCH},tpad=stop_mode=clone:stop_duration=30,trim=duration=${target},setpts=PTS-STARTPTS[v];[1:a]aresample=48000,apad[a]`,
    "-map", "[v]", "-map", "[a]", "-t", target, ...enc, out]);
  files.push({ key: s, out });
  console.log(`${s}: ${dur(v).toFixed(2)}s -> ${target}s`);
}

for (const [scene, cfg] of Object.entries(SCENES)) {
  const v = src(scene);
  const vd = dur(v);
  const edges = [0, ...cfg.cuts, vd];
  for (let i = 0; i < cfg.segs.length; i++) {
    const seg = cfg.segs[i];
    const [b0, b1] = [edges[i], edges[i + 1]];
    const seglen = b1 - b0;
    const aFile = seg.a ? mergedWav(seg.a) : null;
    const ad = aFile ? dur(aFile) + 0.25 /* lead-in delay */ : 0;
    let target;
    if (!aFile) target = Math.min(seglen, seg.hold ?? 1.6);
    else if (seg.mode === "full") target = Math.max(seglen, ad + 0.7);
    else target = Math.max(ad + 0.7, Math.min(seglen, ad + 2.0));
    target = Number(target.toFixed(2));
    const ss = seg.mode === "keepEnd" && target < seglen ? b1 - target : b0;

    const out = path.join(TMP, `${scene}-s${i}.mp4`);
    const vf = `[0:v]trim=start=${ss.toFixed(3)}:end=${b1.toFixed(3)},setpts=PTS-STARTPTS,${VCH},tpad=stop_mode=clone:stop_duration=30,trim=duration=${target},setpts=PTS-STARTPTS[v]`;
    const af = aFile
      ? `[1:a]aresample=48000,adelay=250|250,apad,atrim=duration=${target},asetpts=PTS-STARTPTS[a]`
      : `anullsrc=r=48000:cl=mono,atrim=duration=${target},asetpts=PTS-STARTPTS[a]`;
    const inputs = aFile ? ["-i", v, "-i", aFile] : ["-i", v];
    execFileSync(FF, ["-y", "-loglevel", "error", ...inputs, "-filter_complex", `${vf};${af}`,
      "-map", "[v]", "-map", "[a]", "-t", String(target), ...enc, out]);
    files.push({ key: `${scene}-s${i}`, out });
    const tag = target > seglen + 0.05 ? `FREEZE +${(target - seglen).toFixed(1)}s` : target < seglen - 0.05 ? `trim -${(seglen - target).toFixed(1)}s${seg.mode === "keepEnd" ? " (head)" : ""}` : "as-is";
    console.log(`${scene}-s${i}: seg=${seglen.toFixed(2)}s vo=${ad ? ad.toFixed(2) : "-"}s -> ${target}s [${tag}]`);
  }
}

files.sort((a, b) => a.key.localeCompare(b.key));
const list = path.join(TMP, "list.txt");
fs.writeFileSync(list, files.map((f) => `file '${path.basename(f.out)}'`).join("\n") + "\n");
const final = path.join(DIR, "final-demo-sync.mp4");
execFileSync(FF, ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", final], { cwd: TMP });
console.log(`DONE: ${final} (${dur(final).toFixed(2)}s)`);
