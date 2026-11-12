/**
 * HTTP API on node:http (no framework). Public routes are what the Reverie
 * client calls; /admin routes expose the telemetry, experiments, gate,
 * archive and lifecycle, guarded by REVERIE_ADMIN_TOKEN when it is set.
 *
 *   GET  /health
 *   GET  /v1/personas                     servable persona cards
 *   GET  /v1/personas/:id                 one card
 *   GET  /v1/feed?user_id=&limit=&include_passed=1&exclude=a,b
 *   POST /v1/events   { events: IncomingEvent[] }   (also accepts text/plain for sendBeacon)
 *   POST /v1/chat     { user_id, persona_id, text }
 *
 *   GET  /admin/stats | /admin/stats/:id | /admin/experiments | /admin/gate
 *   GET  /admin/archive | /admin/lifecycle | /admin/safety | /admin/art-queue | /admin/report
 *   GET  /admin/personas/:id/md | /admin/personas/:id/versions
 *   POST /admin/tick
 *   POST /admin/personas/:id/art   { art: { portrait, ... }, activate?: boolean }
 */
import http from 'node:http';
import { chatTurn } from './chat.ts';
import { loadConfig, type DeepPartial, type Config } from './config.ts';
import type { Ctx } from './context.ts';
import { json, openDb } from './db.ts';
import { buildFeed } from './feed/ranker.ts';
import { artBrief } from './lifecycle/evolve.ts';
import { computeGate } from './lifecycle/gate.ts';
import { archive } from './lifecycle/niches.ts';
import { makeLlm, type Llm } from './llm/claude.ts';
import { serializePersona } from './personas/markdown.ts';
import { PersonaRegistry } from './personas/registry.ts';
import type { Persona } from './personas/schema.ts';
import { makeRng } from './stats/random.ts';
import { renderReport, tick } from './jobs/scheduler.ts';
import { ingest, validateEvent } from './telemetry/ingest.ts';
import { computeAllStats, computeStats, scoreAll } from './telemetry/rollups.ts';

export function createContext(overrides: DeepPartial<Config> = {}, llm?: Llm, now?: () => number): Ctx {
  const cfg = loadConfig(overrides);
  const db = openDb(cfg.dbPath);
  const clock = now ?? Date.now;
  const personas = new PersonaRegistry(cfg.personasDir, db, clock).load();
  return { db, cfg, personas, rng: makeRng(), llm: llm ?? makeLlm(cfg), now: clock };
}

/** The card the client renders: the front end's Character fields plus feed metadata. */
export function personaCard(p: Persona) {
  const opener = p.sections.find((s) => s.title === 'Opener')?.body ?? '';
  const bio = p.sections.find((s) => s.title === 'Bio')?.body ?? p.intro;
  return {
    id: p.meta.id,
    name: p.meta.name,
    kind: p.meta.kind,
    style: p.meta.style,
    theme: p.meta.theme,
    tagline: p.meta.tagline,
    bio,
    opener,
    age: p.meta.age,
    flirtLevel: p.meta.flirt_level,
    categories: p.meta.categories,
    gender: p.meta.gender,
    status: p.meta.status,
    version: p.meta.version,
    branch: p.meta.branch,
    parent: p.meta.parent,
    art: p.meta.art,
  };
}

type Handler = (ctx: Ctx, req: http.IncomingMessage, url: URL, params: string[], body: unknown) => Promise<unknown> | unknown;

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const routes: [string, RegExp, Handler, boolean][] = [];
const route = (method: string, pattern: RegExp, h: Handler, admin = false) => routes.push([method, pattern, h, admin]);

route('GET', /^\/health$/, (ctx) => ({ ok: true, personas: ctx.personas.servable().length, llm: ctx.llm.enabled }));

route('GET', /^\/v1\/personas$/, (ctx) => ({ personas: ctx.personas.servable().map(personaCard) }));
route('GET', /^\/v1\/personas\/([a-z0-9-]+)$/, (ctx, _r, _u, [id]) => {
  const p = ctx.personas.get(id);
  if (!p || p.meta.status === 'draft') throw new HttpError(404, 'no such persona');
  return personaCard(p);
});

route('GET', /^\/v1\/feed$/, (ctx, _r, url) => {
  const userId = url.searchParams.get('user_id');
  if (!userId) throw new HttpError(400, 'user_id required');
  const { requestId, cards } = buildFeed(ctx, userId, {
    limit: Number(url.searchParams.get('limit')) || undefined,
    includePassed: url.searchParams.get('include_passed') === '1',
    exclude: (url.searchParams.get('exclude') ?? '').split(',').filter(Boolean),
  });
  return {
    request_id: requestId,
    cards: cards.map((c) => ({ ...personaCard(ctx.personas.get(c.personaId)!), slot: c.slot, position: c.position })),
  };
});

route('POST', /^\/v1\/events$/, (ctx, _r, _u, _p, body) => {
  const events = (body as { events?: unknown[] })?.events;
  if (!Array.isArray(events)) throw new HttpError(400, 'events[] required');
  let accepted = 0;
  for (const e of events.slice(0, 500)) {
    if (!validateEvent(e)) continue;
    ingest(ctx, e);
    accepted++;
  }
  return { accepted, rejected: Math.min(events.length, 500) - accepted };
});

route('POST', /^\/v1\/chat$/, async (ctx, _r, _u, _p, body) => {
  const b = body as { user_id?: string; persona_id?: string; text?: string };
  if (!b?.user_id || !b.persona_id || typeof b.text !== 'string' || !b.text.trim()) throw new HttpError(400, 'user_id, persona_id, text required');
  if (!ctx.personas.get(b.persona_id)) throw new HttpError(404, 'no such persona');
  return chatTurn(ctx, b.user_id, b.persona_id, b.text);
});

route('GET', /^\/admin\/stats$/, (ctx) => ({ stats: computeAllStats(ctx, false) }), true);
route(
  'GET',
  /^\/admin\/stats\/([a-z0-9-]+)$/,
  (ctx, _r, _u, [id]) => {
    const all = scoreAll(ctx, ctx.personas.all().filter((p) => p.meta.status !== 'draft').map((p) => computeStats(ctx, p.meta.id)));
    const s = all.find((x) => x.personaId === id);
    if (!s) throw new HttpError(404, 'no such persona');
    return s;
  },
  true,
);
route(
  'GET',
  /^\/admin\/experiments$/,
  (ctx) => ({
    experiments: (ctx.db.prepare('SELECT * FROM experiments ORDER BY id DESC LIMIT 200').all() as Record<string, unknown>[]).map((e) => ({
      ...e,
      result: json(e.result, null),
    })),
  }),
  true,
);
route('GET', /^\/admin\/gate$/, (ctx) => computeGate(ctx, computeAllStats(ctx, false)), true);
route(
  'GET',
  /^\/admin\/users\/([A-Za-z0-9_:-]+)$/,
  (ctx, _r, _u, [id]) => ({
    user: ctx.db.prepare('SELECT * FROM users WHERE id = ?').get(id) ?? null,
    events: ctx.db.prepare('SELECT type, COUNT(*) AS n FROM events WHERE user_id = ? GROUP BY type').all(id),
    affinity: ctx.db.prepare('SELECT category, a, b FROM user_affinity WHERE user_id = ? ORDER BY a - b DESC').all(id),
    impressions: ctx.db.prepare('SELECT persona_id, slot, p_shown, outcome FROM impressions WHERE user_id = ? ORDER BY id').all(id),
    lastFeed: ctx.db
      .prepare('SELECT persona_id, slot, p_shown FROM feed_serves WHERE request_id = (SELECT request_id FROM feed_serves WHERE user_id = ? ORDER BY ts DESC LIMIT 1) ORDER BY position')
      .all(id),
    conversations: ctx.db.prepare('SELECT * FROM conversations WHERE user_id = ?').all(id),
  }),
  true,
);
route('GET', /^\/admin\/archive$/, (ctx) => ({ niches: archive(ctx) }), true);
route(
  'GET',
  /^\/admin\/lifecycle$/,
  (ctx) => ({
    log: (ctx.db.prepare('SELECT * FROM lifecycle_log ORDER BY id DESC LIMIT 300').all() as Record<string, unknown>[]).map((r) => ({ ...r, detail: json(r.detail, null) })),
  }),
  true,
);
route('GET', /^\/admin\/safety$/, (ctx) => ({ counts: ctx.db.prepare('SELECT kind, COUNT(*) AS n FROM safety_events GROUP BY kind').all() }), true);
route(
  'GET',
  /^\/admin\/art-queue$/,
  (ctx) => ({ drafts: ctx.personas.all().filter((p) => p.meta.status === 'draft').map((p) => ({ id: p.meta.id, name: p.meta.name, brief: artBrief(p) })) }),
  true,
);
route(
  'GET',
  /^\/admin\/personas\/([a-z0-9-]+)\/md$/,
  (ctx, _r, _u, [id]) => {
    const p = ctx.personas.get(id);
    if (!p) throw new HttpError(404, 'no such persona');
    return { md: serializePersona(p) };
  },
  true,
);
route(
  'GET',
  /^\/admin\/personas\/([a-z0-9-]+)\/versions$/,
  (ctx, _r, _u, [id]) => ({ versions: ctx.db.prepare('SELECT version, ts, reason FROM persona_versions WHERE persona_id = ? ORDER BY version').all(id) }),
  true,
);
route(
  'POST',
  /^\/admin\/personas\/([a-z0-9-]+)\/art$/,
  (ctx, _r, _u, [id], body) => {
    const p = ctx.personas.get(id);
    if (!p) throw new HttpError(404, 'no such persona');
    const b = body as { art?: Record<string, string>; activate?: boolean };
    if (!b?.art?.portrait) throw new HttpError(400, 'art.portrait required');
    const art = { ...p.meta.art, ...b.art };
    const status = b.activate !== false && p.meta.status === 'draft' ? 'active' : p.meta.status;
    const saved = ctx.personas.save({ ...p, meta: { ...p.meta, art, status } }, 'art attached');
    return personaCard(saved);
  },
  true,
);
route('POST', /^\/admin\/tick$/, async (ctx) => {
  const r = await tick(ctx);
  return { gate: r.gate, spawned: r.spawned, opened: r.opened, fade: r.fade, evaluations: r.evaluations };
}, true);
route('GET', /^\/admin\/report$/, async (ctx) => {
  const r = await tick(ctx, { writeReport: false });
  return { markdown: renderReport(ctx, r) };
}, true);

function cors(res: http.ServerResponse, origin: string | undefined, allowed: string[]): void {
  const allow = allowed.includes('*') ? '*' : origin && allowed.includes(origin) ? origin : '';
  if (allow) res.setHeader('Access-Control-Allow-Origin', allow);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Vary', 'Origin');
}

async function readBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 1_000_000) throw new HttpError(413, 'body too large');
    chunks.push(c as Buffer);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, 'invalid JSON');
  }
}

export function createServer(ctx: Ctx): http.Server {
  const adminToken = process.env.REVERIE_ADMIN_TOKEN;
  const origins = (process.env.REVERIE_CORS_ORIGINS ?? '*').split(',').map((s) => s.trim());
  return http.createServer(async (req, res) => {
    cors(res, req.headers.origin, origins);
    if (req.method === 'OPTIONS') {
      res.writeHead(204).end();
      return;
    }
    const url = new URL(req.url ?? '/', 'http://localhost');
    try {
      const match = routes.find(([m, re]) => m === req.method && re.test(url.pathname));
      if (!match) throw new HttpError(404, 'not found');
      const [, re, handler, admin] = match;
      if (admin && adminToken && req.headers.authorization !== `Bearer ${adminToken}`) throw new HttpError(401, 'admin token required');
      const params = (re.exec(url.pathname) ?? []).slice(1);
      const body = req.method === 'POST' ? await readBody(req) : null;
      const out = await handler(ctx, req, url, params, body);
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(out));
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error(e);
      res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: (e as Error).message }));
    }
  });
}
