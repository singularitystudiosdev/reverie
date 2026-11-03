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
import { useEffect, useMemo, useRef, useState, type CSSProperties, type JSX } from 'react';
import { createPortal } from 'react-dom';
import type { CharacterStyle } from '../../data/types';
import { useFrameTheme } from '../../theme/ThemeProvider';
import { atmosphereTints, getTheme } from '../../theme/themes';
import '../../styles/bio.css';
import { BioFx } from './bio';
import { isCharacterFxId, parseBio } from './bio/kinds';

/** What every character's opening cinematic receives. */
export interface BioIntroProps {
  /** The bio paragraph, so an intro can act on the text itself (slice it, freeze it, ignite it). */
  bio: HTMLElement;
  /** The frame element the intro is painted over (absolute, inset 0). */
  frame: HTMLElement;
}

/* Opening cinematics, one per character: ./bio/custom/<id>.intro.tsx, default export. */
const INTROS = import.meta.glob('./bio/custom/*.intro.tsx', { eager: true }) as Record<
  string,
  { default: (p: BioIntroProps) => JSX.Element | null }
>;
function introFor(id: string | null) {
  return id ? INTROS[`./bio/custom/${id}.intro.tsx`]?.default ?? null : null;
}

export function AnimatedBio(props: { text: string; style: CharacterStyle }): JSX.Element {
  const { text, style } = props;
  const { themeId } = useFrameTheme();
  const segments = useMemo(() => parseBio(text), [text]);
  // Her id is the one character tag in her own bio ({vesper:...}).
  const ownerId = useMemo(() => {
    for (const s of segments) if (s.type === 'fx' && isCharacterFxId(s.kind)) return s.kind;
    return null;
  }, [segments]);
  const Intro = introFor(ownerId);
  const bioRef = useRef<HTMLParagraphElement>(null);
  const [hosts, setHosts] = useState<{ bio: HTMLElement; frame: HTMLElement } | null>(null);
  useEffect(() => {
    const bio = bioRef.current;
    const frame = bio?.closest<HTMLElement>('[data-frame]') ?? null;
    if (bio && frame) setHosts({ bio, frame });
  }, []);
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
    <>
      <p
        ref={bioRef}
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
      {Intro && hosts
        ? createPortal(
            <div className="bio-intro pointer-events-none absolute inset-0 z-50 overflow-hidden" style={vars} aria-hidden="true">
              <Intro bio={hosts.bio} frame={hosts.frame} />
            </div>,
            hosts.frame
          )
        : null}
    </>
  );
}
