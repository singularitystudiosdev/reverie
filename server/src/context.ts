import type { Config } from './config.ts';
import type { DB } from './db.ts';
import type { Llm } from './llm/claude.ts';
import type { PersonaRegistry } from './personas/registry.ts';
import type { Rng } from './stats/random.ts';

/** Everything a module needs, passed explicitly (no globals), so the simulation can run many in one process. */
export interface Ctx {
  db: DB;
  cfg: Config;
  personas: PersonaRegistry;
  rng: Rng;
  llm: Llm;
  /** Wall clock; the simulation substitutes a virtual one. */
  now: () => number;
}
