/*
  Her bio (profile sheet). The paragraph itself is still: body ink, nothing
  sweeping across it. Specific words carry specific effects instead, tagged in
  the copy as `{kind:words}` (see data/characters.ts): bats circling a
  charged word, petals drifting past it, a neon tube flickering, and so on,
  one small component per kind in ./bio.
  - The words stay real text (inline-block wrappers inside one <p>), so the
    bio wraps, reads and selects as the plain paragraph does; particle layers
    are aria-hidden and sit behind the text.
  - Effect colours come from her theme: the --t-* tokens on the frame plus her
    world's atmosphere tints (themes.ts), written here as --fx-* custom
    properties. No hex lives in a component.
  - bio.css owns the motion. By request it ignores prefers-reduced-motion: the
    word effects always play (bio.css overrides the global clamp).
*/
import { useMemo, type CSSProperties, type JSX } from 'react';
import type { CharacterStyle } from '../../data/types';
import { useFrameTheme } from '../../theme/ThemeProvider';
import { atmosphereTints, getTheme } from '../../theme/themes';
import '../../styles/bio.css';
import { BioFx } from './bio';
import { parseBio } from './bio/kinds';

export function AnimatedBio(props: { text: string; style: CharacterStyle }): JSX.Element {
  const { text, style } = props;
  const { themeId } = useFrameTheme();
  const segments = useMemo(() => parseBio(text), [text]);
  const tint = atmosphereTints[themeId];
  const scheme = getTheme(themeId).scheme;

  const vars = {
    '--fx-fog': tint.fog,
    '--fx-light': tint.light,
    '--fx-deep': tint.deep,
    '--fx-a1': tint.a1,
    '--fx-a2': tint.a2,
  } as CSSProperties;

  return (
    <p
      data-slot="profile-bio"
      data-style={style}
      data-scheme={scheme}
      className="bio relative isolate max-w-[var(--measure)] text-body"
      style={vars}
    >
      {segments.map((seg, i) =>
        seg.type === 'fx' ? <BioFx key={i} kind={seg.kind} text={seg.text} /> : <span key={i}>{seg.text}</span>
      )}
    </p>
  );
}
