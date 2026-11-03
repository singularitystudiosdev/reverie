export type CharacterStyle = 'Anime' | 'Goth' | 'Realistic' | 'Cartoon' | 'Fantasy';
export type StyleFilter = 'All' | CharacterStyle;

export type ThemeId =
  | 'base' | 'grove' | 'crimson' | 'sakura' | 'tide' | 'ember' | 'frost' | 'neon'
  | 'celestial' | 'sunflower' | 'citylights' | 'foxfire' | 'mirage' | 'raven' | 'brass';

export type ParticleKind =
  | 'leaf' | 'maple' | 'petal' | 'rose' | 'ember' | 'snow' | 'bubble' | 'star'
  | 'shootingStar' | 'bat' | 'rain' | 'firefly' | 'sand' | 'wisp' | 'bokeh'
  | 'butterfly' | 'glyph' | 'pollen' | 'feather' | 'gear' | 'steam' | 'sparkle';

export type OverlayKind =
  | 'godrays' | 'fog' | 'vignette' | 'caustics' | 'scanlines' | 'aurora' | 'heat'
  | 'frostEdge' | 'grain' | 'moon' | 'lightning' | 'sunbeam' | 'glitch' | 'lanterns';

export interface ThemeColors {
  stage: string;         // page background around the phone frame (desktop)
  canvas: string;        // frame base color
  canvas2: string;       // second atmosphere stop
  surface: string;       // her bubbles, card groups, list rows (may be translucent rgba)
  surfaceStrong: string; // header pills, composer, round buttons
  ink: string;           // primary text on surface / surfaceStrong
  muted: string;         // secondary text, >= 4.5:1 on surface
  hairline: string;      // 1px borders
  accent: string;        // primary actions, badges, active tab, focus ring, avatar rings
  onAccent: string;      // text/icon on accent, >= 4.5:1
  me: string;            // the user's bubbles
  onMe: string;          // text on me, >= 4.5:1
  glow: string;          // atmosphere light color (overlays only, never UI)
}

export interface ParticleLayer {
  kind: ParticleKind;
  density: number;  // particles per 100,000 CSS px^2 of frame area
  colors: string[];
  speed?: number;   // 1 = default
  size?: number;    // 1 = default
}

export interface ThemeSpec {
  id: ThemeId;
  label: string;          // e.g. "Elderwood grove"
  scheme: 'light' | 'dark';
  colors: ThemeColors;
  particles: ParticleLayer[];
  overlays: OverlayKind[];
  sceneOpacity: number;   // 0..1, how strongly her scene plate shows behind the UI
}

export interface Character {
  id: string;
  name: string;
  kind: string;           // "Elk dryad of the Elderwood"
  style: CharacterStyle;
  theme: ThemeId;
  tagline: string;        // one line on the swipe card
  bio: string;            // 2-3 sentences, profile sheet
  portrait: string;       // /characters/<id>.webp         900x1600
  portraitSm: string;     // /characters/<id>-sm.webp      360x640
  loop: string;           // /characters/<id>-loop.mp4     720x1280, muted seamless loop
  clip: string;           // /characters/<id>-clip.mp4     her video message, 9:16
  clipPoster: string;     // /characters/<id>-clip-poster.jpg
  scene: string;          // /characters/<id>-scene.webp   900x1600
  sceneSm: string;        // /characters/<id>-scene-sm.webp 360x640
  sceneLoop: string;      // /characters/<id>-scene-loop.mp4 720x1280, 4-6 s muted seamless loop of her scene (may 404: the still stays)
  avatarPosition: string; // CSS object-position + transform-origin for round crops, e.g. '50% 24%'
  avatarScale: number;    // zoom for round crops so the face fills the circle, e.g. 2.2
  opener: string;         // her first message after a match
}

export interface CardItem {
  title: string;
  subtitle: string;
  meta: string;           // e.g. "An hour by moonpath"
  image: string;          // usually her sceneSm or portraitSm
  imagePosition?: string; // object-position for the 56px thumb
  imageScale?: number;
}

export type MessageKind = 'text' | 'cards' | 'video';

export interface Message {
  id: string;
  from: 'her' | 'me';
  kind: MessageKind;
  text?: string;
  cards?: CardItem[];
  src?: string;           // video kind: the clip
  poster?: string;        // video kind: the still shown until it plays
  aspect?: number;        // video kind: width / height, 9:16
  at: number;             // epoch ms
}

export interface Conversation {
  characterId: string;
  messages: Message[];
  unread: number;
}
