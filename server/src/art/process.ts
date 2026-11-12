/**
 * Raw generations to the app's five assets per persona. A Node port of
 * scripts/starters/process.sh with the same parameters (needs `magick`,
 * `ffmpeg` and `ffprobe` on PATH):
 *
 *   <id>.webp 893x1600, <id>-sm.webp 357x640 (q80, from the portrait)
 *   <id>-scene.webp 893x1600, <id>-scene-sm.webp 357x640 (q72, from the background)
 *   <id>-loop.mp4 720x1280 24 fps, muted, seamless loop (tail crossfaded into the head)
 *
 * Files are built in a staging directory beside the output and moved into place
 * only when all five exist, so a half-finished run never leaves partial art.
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import type { PersonaArt } from '../personas/schema.ts';

const run = promisify(execFile);

/** Crossfade length of the seamless loop, seconds (process.sh `f`). */
const FADE = 0.75;

export const artFileNames = (id: string) => ({
  portrait: `${id}.webp`,
  portraitSm: `${id}-sm.webp`,
  scene: `${id}-scene.webp`,
  sceneSm: `${id}-scene-sm.webp`,
  loop: `${id}-loop.mp4`,
});

/** The `art` block the persona gets: the same shape and paths the starters use. */
export function artPaths(id: string): Required<Pick<PersonaArt, 'portrait' | 'portraitSm' | 'loop' | 'scene' | 'sceneSm'>> {
  const f = artFileNames(id);
  return {
    portrait: `/characters/${f.portrait}`,
    portraitSm: `/characters/${f.portraitSm}`,
    loop: `/characters/${f.loop}`,
    scene: `/characters/${f.scene}`,
    sceneSm: `/characters/${f.sceneSm}`,
  };
}

async function resize(src: string, dst: string, w: number, h: number, quality: number): Promise<void> {
  await run('magick', [src, '-resize', `${w}x${h}^`, '-gravity', 'center', '-extent', `${w}x${h}`, '-quality', String(quality), dst]);
}

/**
 * Write the five files for `id` into `outDir`. `portrait` and `scene` are the raw image bytes
 * (png or jpeg), `video` the raw mp4. Returns the written file names.
 */
export async function processArt(id: string, raw: { portrait: Buffer; scene: Buffer; video: Buffer }, outDir: string): Promise<string[]> {
  if (!/^[a-z0-9-]+$/.test(id)) throw new Error(`unsafe persona id: ${id}`);
  fs.mkdirSync(outDir, { recursive: true });
  const stage = fs.mkdtempSync(path.join(outDir, `.art-${id}-`));
  try {
    const rawPortrait = path.join(stage, 'raw-portrait.img');
    const rawScene = path.join(stage, 'raw-scene.img');
    const rawVideo = path.join(stage, 'raw-loop.mp4');
    fs.writeFileSync(rawPortrait, raw.portrait);
    fs.writeFileSync(rawScene, raw.scene);
    fs.writeFileSync(rawVideo, raw.video);

    const f = artFileNames(id);
    const out = (name: string) => path.join(stage, name);
    await resize(rawPortrait, out(f.portrait), 893, 1600, 80);
    await resize(rawPortrait, out(f.portraitSm), 357, 640, 80);
    await resize(rawScene, out(f.scene), 893, 1600, 72);
    await resize(rawScene, out(f.sceneSm), 357, 640, 72);

    const probe = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'format=duration', '-of', 'csv=p=0', rawVideo]);
    const d = Number(String(probe.stdout).trim());
    if (!Number.isFinite(d) || d <= 2 * FADE) throw new Error(`video is too short to loop (${String(probe.stdout).trim()} s)`);
    const offset = Math.round((d - 2 * FADE) * 1000) / 1000;
    // Seamless loop: drop the first FADE seconds, then crossfade the clip's last FADE seconds into its first FADE.
    const graph =
      `[0:v:0]scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,fps=24,format=yuv420p,split[a][b];` +
      `[a]trim=start=${FADE},setpts=PTS-STARTPTS[mid];[b]trim=end=${FADE},setpts=PTS-STARTPTS[head];` +
      `[mid][head]xfade=transition=fade:duration=${FADE}:offset=${offset}[v]`;
    await run('ffmpeg', ['-v', 'error', '-y', '-i', rawVideo, '-filter_complex', graph, '-map', '[v]', '-an', '-c:v', 'libx264', '-crf', '28', '-preset', 'slow', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out(f.loop)]);

    const names = Object.values(f);
    for (const n of names) if (!fs.existsSync(out(n)) || fs.statSync(out(n)).size === 0) throw new Error(`processing did not produce ${n}`);
    for (const n of names) fs.renameSync(out(n), path.join(outDir, n));
    return names;
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
}
