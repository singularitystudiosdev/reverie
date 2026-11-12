// Builds the three generation prompts per starter persona (profile still,
// profile video, background) from server/starters/roster.json and writes
// server/starters/prompts.json, kept beside the roster as provenance.
//   node scripts/starters/prompts.mjs
import fs from 'node:fs';

const roster = JSON.parse(fs.readFileSync('server/starters/roster.json', 'utf8')).personas;

const STYLE = {
  Anime: 'high-quality modern anime illustration, clean line art, soft cel shading with painterly lighting, detailed background, key-visual quality',
  Realistic: 'photorealistic portrait photograph, 85mm lens, natural skin texture, shallow depth of field, editorial lighting',
  Goth: 'dark gothic painterly digital illustration, semi-realistic, rich shadows and candlelight',
  Cartoon: '3D animated feature-film character render, soft global illumination, expressive stylized proportions',
  Fantasy: 'lush painterly fantasy illustration, semi-realistic, rich detail and magical atmosphere',
};
const BG = {
  Anime: 'high-quality modern anime background art, painterly lighting, rich depth',
  Realistic: 'photorealistic environment photograph, natural light, shallow depth of field',
  Goth: 'dark gothic painterly environment art, candlelight and deep shadows',
  Cartoon: '3D animated feature-film environment render, soft global illumination, warm stylized detail',
  Fantasy: 'lush painterly fantasy environment art, magical atmosphere',
};

function agePhrase(p) {
  if (p.gender === 'group') return `every member is an adult (${p.age})`;
  const who = p.gender === 'male' ? 'man' : p.gender === 'female' ? 'woman' : 'person';
  const n = /^\d+$/.test(p.age) ? `, ${p.age} years old` : '';
  const human = p.d.form === 'human' || p.d.form === 'witch';
  return human ? `an adult ${who}${n}` : `an adult character (${p.age})`;
}

function setting(look) {
  const parts = look.split(', ');
  return parts[parts.length - 1];
}

const out = {};
for (const p of roster) {
  const subject = p.gender === 'group' ? 'the group' : p.gender === 'male' ? 'he' : p.gender === 'female' ? 'she' : 'they';
  const framing =
    p.gender === 'group'
      ? 'all members together from the waist up, centered, faces in the upper third of the frame, looking at the viewer'
      : 'single character from mid-thigh or waist up, centered, face in the upper third of the frame, looking at the viewer';
  out[p.id] = {
    style: p.style,
    portrait: [
      `Vertical 9:16 character portrait for a dating-style companion app card. Style: ${STYLE[p.style]}.`,
      `Subject: ${p.name}, ${p.kind.charAt(0).toLowerCase() + p.kind.slice(1)}; ${agePhrase(p)}. ${p.look}.`,
      `Composition: ${framing} with an inviting, characterful expression; their world fills the background with depth. Cinematic, flattering light.`,
      'Tasteful and non-explicit; clothing as described. No text, no brand logos, no watermark, no border, no UI.',
    ].join(' '),
    scene: [
      `Vertical 9:16 background plate for a chat app, with no people and no characters at all. Style: ${BG[p.style]}.`,
      `Scene: ${p.scene ?? setting(p.look)}, empty and atmospheric, seen as an establishing view.`,
      'Calm composition with no strong focal object in the center. No text, no brand logos, no watermark, no border.',
    ].join(' '),
    video: [
      `Animate this exact portrait as a subtle living profile picture. <IMAGE_0> stays exactly the same ${p.gender === 'group' ? 'characters' : 'character'}, outfit, framing and background.`,
      `${subject.charAt(0).toUpperCase() + subject.slice(1)} ${subject === 'they' || subject === 'the group' ? 'breathe' : 'breathes'} gently and ${subject === 'they' || subject === 'the group' ? 'blink' : 'blinks'}, hair and clothing sway slightly, the background has soft ambient motion, and the expression warms a little and settles back.`,
      'Static camera, no cuts, no zoom, no new objects or people, no text. Calm idle motion for a seamless loop.',
    ].join(' '),
    videoOmni: [
      'Animate <FIRST_FRAME> as a subtle living profile picture: the same character(s), outfit, framing and background.',
      'Gentle breathing, a blink, hair and clothing sway slightly, soft ambient motion in the background, the expression warms a little and settles back.',
      'Static camera, no cuts, no zoom, no new objects or people, no text. Calm idle motion for a seamless loop.',
    ].join(' '),
  };
}
fs.writeFileSync('server/starters/prompts.json', JSON.stringify(out, null, 1) + '\n');
console.log(`wrote ${Object.keys(out).length} prompt sets`);
