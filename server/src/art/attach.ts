import type { Ctx } from '../context.ts';
import type { Persona, PersonaArt } from '../personas/schema.ts';

/**
 * Merge `art` into a persona's art block and, unless `activate` is false, take a draft live.
 * The one place art is attached: `POST /admin/personas/:id/art` and the automatic art job both call it.
 */
export function attachArt(ctx: Ctx, p: Persona, art: Partial<PersonaArt> | Record<string, string>, activate = true): Persona {
  const merged = { ...p.meta.art, ...art } as PersonaArt;
  const status = activate && p.meta.status === 'draft' ? 'active' : p.meta.status;
  return ctx.personas.save({ ...p, meta: { ...p.meta, art: merged, status } }, 'art attached');
}
