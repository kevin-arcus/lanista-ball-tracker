// Node harness: node test/run.js VIDEO FPS [startFrame endFrame] [width]
// Decodes with ffmpeg at analysis resolution and runs the same engine the web page uses.
const { spawn } = require("child_process");
const E = require("../engine.js");
const [video, fpsArg, s0, e0, wArg] = process.argv.slice(2);
const fps = Number(fpsArg), W = Number(wArg || 960);
const probe = require("child_process").execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", video]).toString().trim().split(",").map(Number);
const scale = Math.min(1, W / probe[0]);
const w = Math.round(probe[0] * scale / 2) * 2, h = Math.round(probe[1] * scale / 2) * 2;
const args = ["-v", "error", "-i", video];
const start = s0 ? Number(s0) : 0, end = e0 ? Number(e0) : null;
let vf = `scale=${w}:${h}:flags=area`;
if (s0) vf = `select='between(n\\,${start}\\,${end})',` + vf;
args.push("-vf", vf, "-fps_mode", "passthrough", "-f", "rawvideo", "-pix_fmt", "rgba", "-");
const eng = E.create({ fps, width: w, height: h });
const ff = spawn("ffmpeg", args);
const fsize = w * h * 4; let buf = Buffer.alloc(0), idx = start; const t0 = Date.now();
ff.stdout.on("data", (d) => {
  buf = Buffer.concat([buf, d]);
  while (buf.length >= fsize) {
    const rgba = new Uint8ClampedArray(buf.subarray(0, fsize)); buf = buf.subarray(fsize);
    const gray = new Uint8Array(w * h);
    for (let i = 0, j = 0; i < gray.length; i++, j += 4) gray[i] = (rgba[j] * 299 + rgba[j + 1] * 587 + rgba[j + 2] * 114 + 500) / 1000;
    eng.push(idx++, gray, rgba);
  }
});
ff.on("close", () => {
  const r = eng.finish();
  console.log(`${video}: ${idx - start} frames ${w}x${h}, ${r.candidates} candidates, ${r.tracks.length} tracks, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  r.events.forEach((e) => {
    if (e.type === "hit") console.log(`  hit frames ${e.batted[0].frame}-${e.batted[e.batted.length - 1].frame}: EV ${e.exitVelocity.toFixed(1)} ± ${e.m.sigmaMph.toFixed(1)} mph, LA ${e.launchAngle.toFixed(1)}, carry ${Math.round(e.carryFt)} ft, ${e.confidence}, n=${e.m.n}, scale=${e.m.scale.method}, d=${e.m.scale.dmed.toFixed(1)} ${e.m.warnings}` + (e.pitchM ? `, pitch ${e.pitchM.speedMph.toFixed(1)}` : ""));
    else console.log(`  pitch ${e.pitchM.speedMph.toFixed(1)} mph ${e.confidence}`);
  });
});
