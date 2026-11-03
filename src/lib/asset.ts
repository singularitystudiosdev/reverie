/**
 * Resolve a public asset path against the app's base, so the same string works
 * at a domain root in dev and under a subpath (e.g. GitHub Pages) in a build.
 *
 *   asset('/fx/a.png') -> '/reverie/fx/a.png' in a build with base '/reverie/'
 *   asset('/fx/a.png') -> '/fx/a.png'          in dev (base '/')
 */
export function asset(path: string): string {
  return `${import.meta.env.BASE_URL}${path.replace(/^\/+/, '')}`;
}
