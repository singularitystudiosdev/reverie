#!/usr/bin/env node
/*
  scripts/fx/render.mjs: painted still -> Kling image-to-video (fal) -> ffmpeg ->
  stacked-alpha H.264 clips in public/fx/<id>/ for the v6 FX player.

    still  --fal Kling i2v-->  clip  --ffmpeg-->  fps/scale  (+ head-tail xfade loop)
           --> alpha (luma | key:RRGGBB | alpha)  --> colour top / alpha bottom, H.264
           --> public/fx/<id>/<clip>.mp4  +  <clip>.poster.png (transparent first frame)

  The ffmpeg half is encode.sh from the proof (reverie-research/proof/encode.sh),
  step for step, including its measurements: frames, distinct frames and solid%.

  usage
    node scripts/fx/render.mjs <id> [options]

  clips (any subset): intro loop frame ring words
    --clip intro,loop        which clips to render (default: every clip that has a still)
    --still <file|url>       the painted still every clip starts from
    --still-<clip> <file|url>     a per-clip still (the words clip wants its grid still)
    --prompt "<text>"        motion direction added to every clip's prompt
    --prompt-<clip> "<text>" motion direction for one clip
    --from-video-<clip> <file>    skip fal: encode a clip you already have (mp4, mov, webm)

  alpha, per clip (the encode.sh 6th argument; default luma)
    --alpha <mode>           luma | key:RRGGBB | alpha, for every clip
    --alpha-<clip> <mode>
      luma        EMISSIVE plates only (fire, glow, embers, sparks, light, mist) painted on pure black
      key:00B140  every SOLID or DARK subject (bats, lace, feathers, masks, gears) painted on a flat
                  key colour; use key:FF00FF when the subject itself is green
      alpha       the input already carries real alpha (VP9 .webm from fal bria/video/background-removal)
    A dark subject keyed as luma ghosts: the script refuses a keyed/alpha clip under 40% solid.

  encode
    --width <px>             stacked frame width (default 540; ring 288)   --width-<clip>
    --fps 24  --gain 1.6  --crf 24  --duration 5 (seconds the model renders, 5 or 10)
    --av1                    also write <clip>.av1.mp4
    --out public/fx          output root
    --no-gate                report the acceptance numbers without failing on them
    --dry-run                print the plan and exit (no key, no network, no ffmpeg)

  fal key: read from the environment variable named by --fal-key-env (default FX_FAL_KEY) or, with
  --fal-key-file <path>, from that file. The key is never printed and never written anywhere.
  --model <fal endpoint>   default fal-ai/kling-video/v2.1/standard/image-to-video
  A vendor or moderation refusal is reported and that clip is skipped (exit code 3): it is never
  reworded or rerouted.

  acceptance per clip: >= 48 frames, >= 95% distinct frames, and solid% >= 40 for keyed/alpha clips.
*/
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CLIPS = ['intro', 'loop', 'frame', 'ring', 'words'];
const ONE_SHOT = new Set(['intro']);
const BOOLEAN_FLAGS = new Set(['av1', 'dry-run', 'no-gate', 'help']);
const XFADE = 0.5;
const MIN_FRAMES = 48;
const MIN_DISTINCT = 0.95;
const MIN_SOLID = 40;
const DEFAULT_MODEL = 'fal-ai/kling-video/v2.1/standard/image-to-video';

const DIRECTION = {
  intro: 'One signature moment that builds, peaks and settles, in a single take.',
  loop: 'Ambient motion that never stops and returns to where it started, drifting evenly across the whole frame.',
  frame: 'Motion hugs the edges of the frame; the centre stays empty and still.',
  ring: 'Motion circles an empty round centre; nothing enters the centre.',
  words: 'Every cell of the grid keeps to its own cell; each cell loops its own small motion and nothing crosses a cell edge.',
};

/* ---- args ---------------------------------------------------------------- */

function parseArgs(argv) {
  const positional = [];
  const flags = new Map();
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) {
      positional.push(a);
      continue;
    }
    const name = a.slice(2);
    if (BOOLEAN_FLAGS.has(name)) flags.set(name, true);
    else {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) fail(`--${name} needs a value`);
      flags.set(name, v);
      i += 1;
    }
  }
  return { positional, flags };
}

function fail(message, code = 2) {
  console.error(`render.mjs: ${message}`);
  process.exit(code);
}

const { positional, flags } = parseArgs(process.argv.slice(2));
if (flags.has('help') || positional.length === 0) {
  console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('*/')[0].replace(/^#!.*\n/, '').replace(/^\/\*\n/, ''));
  process.exit(positional.length === 0 && !flags.has('help') ? 2 : 0);
}
const id = positional[0];
if (!/^[a-z][a-z0-9-]*$/.test(id)) fail(`bad character id "${id}"`);

const perClip = (name, clip, fallback) => flags.get(`${name}-${clip}`) ?? flags.get(name) ?? fallback;
const num = (name, fallback) => {
  const v = flags.get(name);
  if (v === undefined) return fallback;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) fail(`--${name} must be a positive number`);
  return n;
};

const outRoot = path.resolve(String(flags.get('out') ?? 'public/fx'));
const outDir = path.join(outRoot, id);
const fps = num('fps', 24);
const gain = num('gain', 1.6);
const crf = num('crf', 24);
const seconds = num('duration', 5);
const model = String(flags.get('model') ?? DEFAULT_MODEL);

const wanted = flags.has('clip') ? String(flags.get('clip')).split(',').map((s) => s.trim()) : CLIPS;
for (const c of wanted) if (!CLIPS.includes(c)) fail(`unknown clip "${c}" (${CLIPS.join(', ')})`);

const plan = [];
for (const clip of wanted) {
  const fromVideo = flags.get(`from-video-${clip}`);
  const still = perClip('still', clip, undefined);
  if (!fromVideo && !still) {
    if (flags.has('clip')) fail(`clip "${clip}" has no --still or --from-video-${clip}`);
    continue;
  }
  const alpha = String(perClip('alpha', clip, 'luma'));
  if (!/^(luma|alpha|key:[0-9A-Fa-f]{6})$/.test(alpha)) fail(`bad alpha mode "${alpha}" for ${clip}`);
  plan.push({
    clip,
    still,
    fromVideo,
    alpha,
    width: Number(perClip('width', clip, clip === 'ring' ? 288 : 540)),
    loop: !ONE_SHOT.has(clip),
    prompt: buildPrompt(clip, alpha, flags.get(`prompt-${clip}`) ?? flags.get('prompt')),
  });
}
if (plan.length === 0) fail('nothing to render: give --still (or --still-<clip>, --from-video-<clip>)');

function buildPrompt(clip, alpha, extra) {
  const bg = alpha === 'luma' ? 'pure black' : alpha === 'alpha' ? 'plain' : `flat solid #${alpha.slice(4).toUpperCase()}`;
  return [
    `Animate this painted effect plate: every frame freshly rendered, painterly detail, natural motion.`,
    DIRECTION[clip],
    extra ?? '',
    `The background stays ${bg} for the entire clip. Locked-off camera, no cuts, no text, no people.`,
  ]
    .filter(Boolean)
    .join(' ');
}

if (flags.has('dry-run')) {
  const falClips = plan.filter((p) => !p.fromVideo).length;
  console.log(JSON.stringify({ id, outDir, model, seconds, fps, gain, crf, estimatedFalUsd: +(falClips * 0.35).toFixed(2), clips: plan }, null, 2));
  process.exit(0);
}

/* ---- fal ------------------------------------------------------------------- */

function falKey() {
  const file = flags.get('fal-key-file');
  if (file) {
    const k = fs.readFileSync(String(file), 'utf8').trim();
    if (!k) fail(`--fal-key-file ${file} is empty`);
    return k;
  }
  const name = String(flags.get('fal-key-env') ?? 'FX_FAL_KEY');
  const k = process.env[name];
  if (!k) fail(`no fal key: set $${name} or pass --fal-key-file <path>`);
  return k;
}

class Refusal extends Error {}

function stillUrl(still) {
  if (/^https?:\/\//.test(still)) return still;
  const ext = path.extname(still).slice(1).toLowerCase();
  const mime = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' }[ext];
  if (!mime) fail(`still ${still}: png, jpg or webp only`);
  return `data:${mime};base64,${fs.readFileSync(still).toString('base64')}`;
}

async function fal(url, key, init = {}) {
  const res = await fetch(url, { ...init, headers: { Authorization: `Key ${key}`, 'Content-Type': 'application/json', ...init.headers } });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }
  if (!res.ok) {
    const detail = JSON.stringify(body.detail ?? body).slice(0, 400);
    if (res.status === 422 || /moderat|safety|policy|flagged|nsfw|content/i.test(detail)) throw new Refusal(`fal refused (${res.status}): ${detail}`);
    throw new Error(`fal ${res.status}: ${detail}`);
  }
  return body;
}

async function generate(item, key, work) {
  const queued = await fal(`https://queue.fal.run/${model}`, key, {
    method: 'POST',
    body: JSON.stringify({
      prompt: item.prompt,
      image_url: stillUrl(item.still),
      duration: String(seconds),
      negative_prompt: 'text, watermark, people, camera movement, cuts, background change, blur',
      cfg_scale: 0.5,
    }),
  });
  console.log(`  ${item.clip}: queued ${queued.request_id}`);
  for (let waited = 0; ; waited += 5) {
    await new Promise((r) => setTimeout(r, 5000));
    const st = await fal(queued.status_url, key);
    if (st.status === 'COMPLETED') break;
    if (st.status !== 'IN_QUEUE' && st.status !== 'IN_PROGRESS') throw new Error(`fal status ${st.status}`);
    if (waited > 1200) throw new Error('fal job took more than 20 minutes');
  }
  const out = await fal(queued.response_url, key);
  const videoUrl = out?.video?.url;
  if (!videoUrl) throw new Refusal(`fal returned no video: ${JSON.stringify(out).slice(0, 300)}`);
  const res = await fetch(videoUrl);
  if (!res.ok) throw new Error(`download ${res.status}`);
  const file = path.join(work, `${item.clip}.raw.mp4`);
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  return file;
}

/* ---- ffmpeg (encode.sh, step for step) ---------------------------------------- */

function ff(args, opts = {}) {
  return execFileSync('ffmpeg', ['-v', 'error', '-y', ...args], { maxBuffer: 1 << 28, ...opts });
}

function ffprobe(args) {
  return execFileSync('ffprobe', ['-v', 'error', ...args], { encoding: 'utf8' }).trim();
}

function stats(args) {
  const text = execFileSync('ffmpeg', ['-v', 'error', ...args], { encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] });
  return [...text.matchAll(/lavfi\.signalstats\.YAVG=([0-9.]+)/g)].map((m) => Number(m[1]));
}

function encode(item, input, work) {
  const { clip, alpha, width, loop } = item;
  const dec = input.endsWith('.webm') ? ['-c:v', 'libvpx-vp9'] : [];
  const loopMov = path.join(work, `${clip}.loop.mov`);
  const rgbaMov = path.join(work, `${clip}.rgba.mov`);
  const scale = `fps=${fps},scale=${width}:-2:flags=lanczos,format=rgba`;

  // 1) seamless loop: crossfade the tail into the head, drop the head copy. A one-shot is only scaled.
  if (loop) {
    const dur = Number(ffprobe(['-show_entries', 'format=duration', '-of', 'csv=p=0', input]));
    const bodyEnd = dur - XFADE;
    ff(
      [
        ...dec,
        '-i', input,
        '-filter_complex',
        `[0:v]${scale},split=3[a][b][c];` +
          `[a]trim=0:${XFADE},setpts=PTS-STARTPTS[head];` +
          `[b]trim=${XFADE}:${bodyEnd},setpts=PTS-STARTPTS[body];` +
          `[c]trim=${bodyEnd}:${dur},setpts=PTS-STARTPTS[tail];` +
          `[tail][head]xfade=transition=fade:duration=${XFADE}:offset=0[join];` +
          `[body][join]concat=n=2:v=1:a=0,format=rgba[v]`,
        '-map', '[v]', '-an', '-c:v', 'png', '-f', 'mov', loopMov,
      ]
    );
  } else {
    ff([...dec, '-i', input, '-vf', scale, '-an', '-c:v', 'png', '-f', 'mov', loopMov]);
  }

  // 2) alpha, per mode.
  if (alpha === 'luma') {
    const A = `min(255,${gain}*max(max(r(X,Y),g(X,Y)),b(X,Y)))`;
    const un = (c) => `min(255,${c}(X,Y)*255/max(1,${A}))`;
    ff(['-i', loopMov, '-vf', `format=rgba,geq=r='${un('r')}':g='${un('g')}':b='${un('b')}':a='${A}'`, '-c:v', 'png', '-f', 'mov', rgbaMov]);
  } else if (alpha.startsWith('key:')) {
    const hex = alpha.slice(4);
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    const spill = g > r && g > b ? ',despill=type=green:mix=0.6' : b > r && b > g ? ',despill=type=blue:mix=0.6' : '';
    ff(['-i', loopMov, '-vf', `chromakey=0x${hex}:0.13:0.08${spill},format=rgba`, '-c:v', 'png', '-f', 'mov', rgbaMov]);
  } else {
    fs.copyFileSync(loopMov, rgbaMov);
  }

  // 3) stacked alpha: colour on top, alpha as luma below.
  const out = path.join(outDir, `${clip}.mp4`);
  const stack = '[0:v]format=pix_fmts=yuva444p[m];[m]split[m][al];[al]alphaextract[al];[m][al]vstack';
  fs.mkdirSync(outDir, { recursive: true });
  ff(['-i', rgbaMov, '-filter_complex', stack, '-pix_fmt', 'yuv420p', '-an', '-c:v', 'libx264', '-preset', 'slow', '-crf', String(crf), '-movflags', '+faststart', out]);
  if (flags.has('av1')) {
    ff(['-i', rgbaMov, '-filter_complex', stack, '-pix_fmt', 'yuv420p', '-an', '-c:v', 'libsvtav1', '-crf', '40', '-preset', '6', '-movflags', '+faststart', path.join(outDir, `${clip}.av1.mp4`)]);
  }
  // The transparent first frame (PNG with alpha, not stacked) the player shows until the video presents.
  ff(['-i', rgbaMov, '-frames:v', '1', path.join(outDir, `${clip}.poster.png`)]);

  // 4) measure: frames, distinct frames, solid%.
  const frames = Number(ffprobe(['-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', out]));
  const diffs = stats(['-i', loopMov, '-vf', 'format=yuv444p,tblend=all_mode=difference,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-', '-f', 'null', '-']);
  const distinct = diffs.filter((v) => v > 0.3).length + 1;
  const mean = (expr) => {
    const v = stats(['-i', rgbaMov, '-vf', `alphaextract,lutyuv=y='${expr}',signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-`, '-f', 'null', '-']);
    return v.reduce((s, x) => s + x, 0) / Math.max(1, v.length);
  };
  const visible = mean('if(gt(val,8),255,0)');
  const solid = visible > 0 ? (100 * mean('if(gte(val,128),255,0)')) / visible : 0;
  const size = ffprobe(['-show_entries', 'stream=width,height', '-of', 'csv=p=0', out]);
  return { clip, alpha, frames, distinct, solidPct: +solid.toFixed(1), bytes: fs.statSync(out).size, size, file: path.relative(process.cwd(), out) };
}

/* ---- run ------------------------------------------------------------------- */

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'fx-render-'));
const results = [];
let refused = 0;
let failedGate = 0;
try {
  const key = plan.some((p) => !p.fromVideo) ? falKey() : null;
  console.log(`render ${id}: ${plan.map((p) => `${p.clip}(${p.alpha})`).join(' ')}  ->  ${path.relative(process.cwd(), outDir)}`);
  const jobs = await Promise.all(
    plan.map(async (item) => {
      try {
        const input = item.fromVideo ? path.resolve(String(item.fromVideo)) : await generate(item, key, work);
        return { item, input };
      } catch (err) {
        if (err instanceof Refusal) {
          refused += 1;
          console.error(`  ${item.clip}: REFUSED, skipped. ${err.message}`);
          return null;
        }
        throw err;
      }
    })
  );
  for (const job of jobs) {
    if (!job) continue;
    const r = encode(job.item, job.input, work);
    const problems = [];
    if (r.frames < MIN_FRAMES) problems.push(`frames ${r.frames} < ${MIN_FRAMES}`);
    if (r.distinct / r.frames < MIN_DISTINCT) problems.push(`distinct ${r.distinct}/${r.frames} < ${MIN_DISTINCT * 100}%`);
    if (r.alpha !== 'luma' && r.solidPct < MIN_SOLID) problems.push(`solid ${r.solidPct}% < ${MIN_SOLID}% (ghosted: re-render on a key colour)`);
    results.push({ ...r, problems });
    console.log(
      `  ${r.clip}: mode=${r.alpha} frames=${r.frames} distinct=${r.distinct} solid=${r.solidPct}% h264=${r.bytes}B size=${r.size}` +
        (problems.length ? `  GATE: ${problems.join('; ')}` : '')
    );
    if (problems.length && !flags.has('no-gate')) failedGate += 1;
  }
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}

console.log(JSON.stringify({ id, clips: results }, null, 2));
if (refused > 0) process.exit(3);
if (failedGate > 0) process.exit(1);
