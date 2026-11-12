/**
 * The three generation prompts per persona (profile still, background plate,
 * profile video). One builder shared by `scripts/starters/prompts.mjs` (the
 * hand-written starter roster) and the server's art job (personas the loop
 * invents), so a persona the server makes is drawn the same way a starter is.
 *
 * Always adult, non-explicit, fully clothed, no text or logos. Retries reuse
 * these exact prompts; nothing here gets more revealing under any condition.
 * Only the starter roster's own `spicy` group gets the pin-up wording, and it
 * stays clothed and non-explicit.
 */

export interface ArtSubject {
  name: string;
  /** "Tsundere rival at the esports café" */
  kind: string;
  /** Anime | Realistic | Goth | Cartoon | Fantasy (the front end's CharacterStyle). */
  style: string;
  /** Stated adult age, "27" or "ageless (adult)". */
  age: string;
  gender: 'female' | 'male' | 'group' | 'nonbinary' | string;
  /** descriptors.form: human | witch | elf-fae | animal-anthro | ... */
  form: string;
  /** Comma-separated description of the character and, last, the setting. */
  look: string;
  /** The empty background scene; defaults to the last part of `look`. */
  scene?: string;
  /** Starter roster only: the glamorous "spicy" group (still clothed, non-explicit). */
  spicy?: boolean;
  /** Server-invented personas: spell out fully clothed and non-explicit in the portrait prompt. */
  strict?: boolean;
  /** Extra art direction appended to the portrait prompt (the server's `artBrief`). */
  brief?: string;
}

export interface ArtPrompts {
  style: string;
  portrait: string;
  scene: string;
  /** Contains the `<IMAGE_0>` placeholder, see {@link videoPromptFor}. */
  video: string;
  videoOmni: string;
}

export const STYLE: Record<string, string> = {
  Anime: 'high-quality modern anime illustration, clean line art, soft cel shading with painterly lighting, detailed background, key-visual quality',
  Realistic: 'photorealistic portrait photograph, 85mm lens, natural skin texture, shallow depth of field, editorial lighting',
  Goth: 'dark gothic painterly digital illustration, semi-realistic, rich shadows and candlelight',
  Cartoon: '3D animated feature-film character render, soft global illumination, expressive stylized proportions',
  Fantasy: 'lush painterly fantasy illustration, semi-realistic, rich detail and magical atmosphere',
};
export const BG: Record<string, string> = {
  Anime: 'high-quality modern anime background art, painterly lighting, rich depth',
  Realistic: 'photorealistic environment photograph, natural light, shallow depth of field',
  Goth: 'dark gothic painterly environment art, candlelight and deep shadows',
  Cartoon: '3D animated feature-film environment render, soft global illumination, warm stylized detail',
  Fantasy: 'lush painterly fantasy environment art, magical atmosphere',
};

function agePhrase(p: ArtSubject): string {
  if (p.gender === 'group') return `every member is an adult (${p.age})`;
  const who = p.gender === 'male' ? 'man' : p.gender === 'female' ? 'woman' : 'person';
  const n = /^\d+$/.test(p.age) ? `, ${p.age} years old` : '';
  const human = p.form === 'human' || p.form === 'witch';
  return human ? `an adult ${who}${n}` : `an adult character (${p.age})`;
}

function setting(look: string): string {
  const parts = look.split(', ');
  return parts[parts.length - 1];
}

export function buildPrompts(p: ArtSubject): ArtPrompts {
  const subject = p.gender === 'group' ? 'the group' : p.gender === 'male' ? 'he' : p.gender === 'female' ? 'she' : 'they';
  const plural = subject === 'they' || subject === 'the group';
  const framing =
    p.gender === 'group'
      ? 'all members together from the waist up, centered, faces in the upper third of the frame, looking at the viewer'
      : 'single character from mid-thigh or waist up, centered, face in the upper third of the frame, looking at the viewer';
  const style = STYLE[p.style] ?? STYLE.Fantasy;
  const bg = BG[p.style] ?? BG.Fantasy;
  return {
    style: p.style,
    portrait: [
      `Vertical 9:16 character portrait for a dating-style companion app card. Style: ${style}.`,
      `Subject: ${p.name}, ${p.kind.charAt(0).toLowerCase() + p.kind.slice(1)}; ${agePhrase(p)}. ${p.look}.`,
      `Composition: ${framing} with an inviting, characterful expression; their world fills the background with depth. Cinematic, flattering light.`,
      p.spicy
        ? 'Alluring pin-up glamour: a confident, flirtatious pose and a sultry, playful expression; the form-fitting outfit exactly as described. Sexy but fully clothed and non-explicit: no nudity, no lingerie, no see-through clothing. No text, no brand logos, no watermark, no border, no UI.'
        : p.strict
          ? 'Tasteful and non-explicit; the character is fully and modestly clothed, clothing as described. No nudity, no lingerie, no see-through clothing. No text, no brand logos, no watermark, no border, no UI.'
          : 'Tasteful and non-explicit; clothing as described. No text, no brand logos, no watermark, no border, no UI.',
      ...(p.brief ? [`Art direction: ${p.brief}`] : []),
    ].join(' '),
    scene: [
      `Vertical 9:16 background plate for a chat app, with no people and no characters at all. Style: ${bg}.`,
      `Scene: ${p.scene ?? setting(p.look)}, empty and atmospheric, seen as an establishing view.`,
      'Calm composition with no strong focal object in the center. No text, no brand logos, no watermark, no border.',
    ].join(' '),
    video: [
      `Animate this exact portrait as a subtle living profile picture. <IMAGE_0> stays exactly the same ${p.gender === 'group' ? 'characters' : 'character'}, outfit, framing and background.`,
      `${subject.charAt(0).toUpperCase() + subject.slice(1)} ${plural ? 'breathe' : 'breathes'} gently and ${plural ? 'blink' : 'blinks'}, hair and clothing sway slightly, the background has soft ambient motion, and ${p.spicy ? 'the expression turns into a slow, confident smile and a playful wink, then settles back' : 'the expression warms a little and settles back'}.`,
      'Static camera, no cuts, no zoom, no new objects or people, no text. Calm idle motion for a seamless loop.',
    ].join(' '),
    videoOmni: [
      'Animate <FIRST_FRAME> as a subtle living profile picture: the same character(s), outfit, framing and background.',
      'Gentle breathing, a blink, hair and clothing sway slightly, soft ambient motion in the background, the expression warms a little and settles back.',
      'Static camera, no cuts, no zoom, no new objects or people, no text. Calm idle motion for a seamless loop.',
    ].join(' '),
  };
}

/** The video prompt for an API that takes the still as its first frame (the image is attached, not named). */
export function videoPromptFor(prompts: ArtPrompts): string {
  return prompts.video.replace('<IMAGE_0>', 'The image');
}
