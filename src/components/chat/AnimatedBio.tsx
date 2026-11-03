/*
  Her bio, animated (profile sheet): every word rises in with a soft fade,
  then a band of her world's accent sweeps across the paragraph on a loop.
  - The sweep is chosen by her style: Anime gets a narrow glint plus drifting
    petal sparks, Goth a wider band over a slow ember glow, every other world
    a soft light band. The colour comes from --t-accent, never a literal.
  - The word-by-word stagger, the sweep and both extra layers are CSS in
    tokens.css, where prefers-reduced-motion stills all of it (the words just
    appear as ink). No JS timer runs here.
  - The words stay real text: inline-block spans separated by spaces, so it
    wraps, reads and selects as the original paragraph does.
*/
import type { CSSProperties, JSX } from 'react';
import type { CharacterStyle } from '../../data/types';

type Sweep = 'anime' | 'goth' | 'soft';

function sweepFor(style: CharacterStyle): Sweep {
  if (style === 'Anime') return 'anime';
  if (style === 'Goth') return 'goth';
  return 'soft';
}

export function AnimatedBio(props: { text: string; style: CharacterStyle }): JSX.Element {
  const { text, style } = props;
  const sweep = sweepFor(style);
  const words = text.split(/\s+/).filter(Boolean);

  return (
    <p data-slot="profile-bio" data-sweep={sweep} className="bio relative isolate max-w-[var(--measure)] text-body">
      {sweep === 'anime' ? (
        <span aria-hidden="true" className="bio-sparks pointer-events-none absolute inset-0 z-0">
          <span data-spark="1" className="bio-spark" />
          <span data-spark="2" className="bio-spark" />
          <span data-spark="3" className="bio-spark" />
        </span>
      ) : null}
      {sweep === 'goth' ? <span aria-hidden="true" className="bio-ember" /> : null}
      <span className="relative z-1">
        {words.map((word, i) => (
          <span key={`${word}-${i}`}>
            {i > 0 ? ' ' : null}
            <span className="bio-word" style={{ '--bio-word': i } as CSSProperties}>
              {word}
            </span>
          </span>
        ))}
      </span>
    </p>
  );
}
