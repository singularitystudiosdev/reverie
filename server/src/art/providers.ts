/**
 * Image and video providers for the automatic art job, behind one interface so
 * tests inject a fake. Plain `fetch`, no SDK, no dependency.
 *
 * Docs read 2026-11-11 (model ids, endpoints, request and response shapes):
 *
 * Stills and backgrounds, Google Gemini "Nano Banana 2.1":
 *   https://ai.google.dev/gemini-api/docs/image-generation   (model `gemini-nano-banana-2.1`)
 *   https://ai.google.dev/gemini-api/docs/interactions       (Interactions API, GA June 2026)
 *   https://ai.google.dev/api/interactions-api               (Interaction resource: status, steps, errors)
 *   https://ai.google.dev/gemini-api/docs/pricing            (images: $30 / 1M output tokens, about $0.0336 1K and $0.0504 2K)
 *   POST https://generativelanguage.googleapis.com/v1beta/interactions
 *     headers  x-goog-api-key, Content-Type: application/json, Api-Revision: 2026-05-20
 *     body     { model, input: [{type:'text', text}], response_format: {type:'image', aspect_ratio:'9:16', image_size},
 *                store: false }
 *     response { status: completed|failed|..., steps: [{type:'model_output', content:[{type:'image', data(base64), mime_type}]}],
 *                errors?: [{code, message}] }
 *   The legacy generateContent API is still supported, but the docs now recommend Interactions for new work.
 *
 * Profile video, xAI Grok Imagine (image-to-video, async):
 *   https://docs.x.ai/developers/model-capabilities/video/generation       (request fields, polling, status, errors)
 *   https://docs.x.ai/developers/model-capabilities/video/image-to-video   (`image` is the first frame; URL or data URI)
 *   https://docs.x.ai/developers/models/grok-imagine-video                 (grok-imagine-video, $0.050 per second)
 *   https://docs.x.ai/developers/pricing
 *   POST https://api.x.ai/v1/videos/generations   Authorization: Bearer $XAI_API_KEY
 *     body     { model, prompt, image:{url:'data:image/png;base64,...'}, duration:6, resolution:'720p',
 *                aspect_ratio:'9:16', generate_audio:false }      -> { request_id }
 *   GET  https://api.x.ai/v1/videos/{request_id}
 *     response { status: pending|done|failed(|expired), video:{url,duration,respect_moderation}, error:{code,message} }
 *   Image-to-video output always matches the still's aspect ratio (`aspect_ratio` is ignored); the clip URL is temporary,
 *   so it is downloaded at once. Failed jobs with `invalid_argument` include content blocked by moderation.
 */
import type { Config } from '../config.ts';

export interface ArtProvider {
  /** The portrait: a 9:16 image. */
  still(prompt: string): Promise<Buffer>;
  /** The background plate: a 9:16 image. */
  scene(prompt: string): Promise<Buffer>;
  /** The profile video with `still` as its first frame: a 9:16, 6 s mp4. */
  video(prompt: string, still: Buffer): Promise<Buffer>;
}

/**
 * A provider failure. `refused` is a moderation block or an empty answer (never retried with
 * a looser prompt); `billed` says whether the provider may have charged for the attempt.
 */
export class ArtProviderError extends Error {
  kind: 'refused' | 'failed';
  billed: boolean;
  constructor(message: string, kind: 'refused' | 'failed' = 'failed', billed = false) {
    super(message);
    this.name = 'ArtProviderError';
    this.kind = kind;
    this.billed = billed;
  }
}

type ArtCfg = Config['art'];
type Fetch = typeof fetch;

export interface ProviderOptions {
  fetch?: Fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Video poll gap (docs: poll every few seconds) and give-up time. */
  pollMs?: number;
  videoTimeoutMs?: number;
  requestTimeoutMs?: number;
}

const BLOCKED = /safety|block|prohibit|policy|moderat|violat|not allowed|harm/i;

export function sniffMime(b: Buffer): string {
  if (b.length > 3 && b[0] === 0x89 && b[1] === 0x50) return 'image/png';
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg';
  if (b.length > 11 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return 'image/png';
}

interface GeminiBlock {
  type?: string;
  data?: string;
  text?: string;
}
interface GeminiInteraction {
  status?: string;
  steps?: { type?: string; content?: GeminiBlock[] }[];
  errors?: { code?: string; message?: string }[];
  error?: { message?: string };
}

export class GeminiXaiProvider implements ArtProvider {
  private cfg: ArtCfg;
  private f: Fetch;
  private sleep: (ms: number) => Promise<void>;
  private pollMs: number;
  private videoTimeoutMs: number;
  private requestTimeoutMs: number;

  constructor(cfg: ArtCfg, opts: ProviderOptions = {}) {
    this.cfg = cfg;
    this.f = opts.fetch ?? fetch;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.pollMs = opts.pollMs ?? 5_000;
    this.videoTimeoutMs = opts.videoTimeoutMs ?? 10 * 60_000;
    this.requestTimeoutMs = opts.requestTimeoutMs ?? 120_000;
  }

  still(prompt: string): Promise<Buffer> {
    return this.gemini(prompt);
  }
  scene(prompt: string): Promise<Buffer> {
    return this.gemini(prompt);
  }

  private async gemini(prompt: string): Promise<Buffer> {
    if (!this.cfg.geminiKey) throw new ArtProviderError('GEMINI_API_KEY is not set');
    const res = await this.f('https://generativelanguage.googleapis.com/v1beta/interactions', {
      method: 'POST',
      headers: { 'x-goog-api-key': this.cfg.geminiKey, 'Content-Type': 'application/json', 'Api-Revision': '2026-05-20' },
      body: JSON.stringify({
        model: this.cfg.imageModel,
        input: [{ type: 'text', text: prompt }],
        response_format: { type: 'image', aspect_ratio: '9:16', image_size: this.cfg.imageSize },
        store: false,
      }),
      signal: AbortSignal.timeout(this.requestTimeoutMs),
    });
    const body = (await res.json().catch(() => ({}))) as GeminiInteraction;
    if (!res.ok) {
      const msg = body.error?.message ?? `HTTP ${res.status}`;
      throw new ArtProviderError(`gemini ${res.status}: ${msg}`, res.status === 400 && BLOCKED.test(msg) ? 'refused' : 'failed');
    }
    const blocks = (body.steps ?? []).flatMap((s) => (s.type === 'model_output' ? (s.content ?? []) : []));
    const image = blocks.find((b) => b.type === 'image' && b.data);
    if (image?.data) return Buffer.from(image.data, 'base64');
    const why = body.errors?.map((e) => e.message ?? e.code).filter(Boolean).join('; ') || blocks.find((b) => b.text)?.text?.slice(0, 200) || `status ${body.status ?? 'unknown'}`;
    // No image comes back when the model declines or the prompt is filtered: that is a refusal, not an outage.
    throw new ArtProviderError(`gemini returned no image: ${why}`, body.status === 'failed' && !BLOCKED.test(why) ? 'failed' : 'refused');
  }

  async video(prompt: string, still: Buffer): Promise<Buffer> {
    if (!this.cfg.xaiKey) throw new ArtProviderError('XAI_API_KEY is not set');
    const auth = { Authorization: `Bearer ${this.cfg.xaiKey}` };
    const submit = await this.f('https://api.x.ai/v1/videos/generations', {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.cfg.videoModel,
        prompt,
        image: { url: `data:${sniffMime(still)};base64,${still.toString('base64')}` },
        duration: this.cfg.videoSeconds,
        resolution: '720p',
        aspect_ratio: '9:16',
        generate_audio: false,
      }),
      signal: AbortSignal.timeout(this.requestTimeoutMs),
    });
    const sub = (await submit.json().catch(() => ({}))) as { request_id?: string; error?: unknown; message?: string };
    if (!submit.ok || !sub.request_id) {
      const msg = typeof sub.error === 'string' ? sub.error : ((sub.error as { message?: string } | undefined)?.message ?? sub.message ?? `HTTP ${submit.status}`);
      throw new ArtProviderError(`xai video submit ${submit.status}: ${msg}`, submit.status === 400 && BLOCKED.test(msg) ? 'refused' : 'failed');
    }
    const deadline = Date.now() + this.videoTimeoutMs;
    for (;;) {
      await this.sleep(this.pollMs);
      const r = await this.f(`https://api.x.ai/v1/videos/${encodeURIComponent(sub.request_id)}`, { headers: auth, signal: AbortSignal.timeout(this.requestTimeoutMs) });
      const j = (await r.json().catch(() => ({}))) as {
        status?: string;
        video?: { url?: string; respect_moderation?: boolean };
        error?: { code?: string; message?: string };
      };
      if (!r.ok) {
        if (r.status >= 500 || r.status === 429) {
          if (Date.now() > deadline) throw new ArtProviderError(`xai video poll ${r.status}`, 'failed', true);
          continue; // transient; keep polling until the deadline
        }
        throw new ArtProviderError(`xai video poll ${r.status}`, 'failed', true);
      }
      if (j.status === 'done') {
        if (j.video?.respect_moderation === false || !j.video?.url) throw new ArtProviderError('xai video filtered by moderation', 'refused', true);
        const dl = await this.f(j.video.url, { signal: AbortSignal.timeout(this.requestTimeoutMs) });
        if (!dl.ok) throw new ArtProviderError(`xai video download ${dl.status}`, 'failed', true);
        return Buffer.from(await dl.arrayBuffer());
      }
      if (j.status === 'failed' || j.status === 'expired') {
        const msg = `${j.error?.code ?? j.status}: ${j.error?.message ?? ''}`.trim();
        throw new ArtProviderError(`xai video ${msg}`, j.error?.code === 'invalid_argument' && BLOCKED.test(msg) ? 'refused' : 'failed', true);
      }
      if (Date.now() > deadline) throw new ArtProviderError(`xai video timed out after ${Math.round(this.videoTimeoutMs / 1000)}s`, 'failed', true);
    }
  }
}

/** The keys the real provider needs and are missing (empty when ready). */
export function missingArtKeys(cfg: ArtCfg): string[] {
  return [cfg.geminiKey ? '' : 'GEMINI_API_KEY', cfg.xaiKey ? '' : 'XAI_API_KEY'].filter(Boolean);
}
