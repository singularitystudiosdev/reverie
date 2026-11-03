/*
  geometry.ts: the rounded-rect signed distance field and the canvas that turns
  it into a displacement map for feDisplacementMap.

  The map is one RGBA raster, read by the filter in filter.ts:
    R  the backdrop sample's x shift, encoded around 128 (128 = no shift)
    G  the backdrop sample's y shift, likewise
    B  the rim mask: 1 on the lit edge, 0 in the body and outside the shape
    A  opaque, so feImage hands the channels over unchanged

  How the numbers were chosen (see glass.css for the sources): Apple's Liquid
  Glass bends and concentrates the light of whatever is behind it at the rim
  (WWDC25 session 219, "Lensing"), so the shift peaks at the edge and falls to
  zero before the middle. The direction is the SDF's outward normal, so the
  bent content reads as a bevel all the way around a pill. The rim mask is a
  lighting term, not a painted gradient: a 1px line plus a softer bevel glow,
  scaled by how squarely that part of the edge faces the light (top left).
*/

/** The optical profile, read from tokens.css so no design value lives here. */
export interface GlassOptics {
  band: number;
  bandRatio: number;
  depth: number;
  sizeRef: number;
  dispersion: number;
  bendPower: number;
  rimSharp: number;
  rimSoft: number;
  rim: number;
  ambient: number;
  facingPower: number;
  softShare: number;
  ring: number;
  ringCenter: number;
  ringWidth: number;
  margin: number;
  shift: number;
}

export interface GlassGeometry {
  width: number;
  height: number;
  radius: number;
}

/**
 * The map's own resolution, in pixels per CSS px. Measured on this machine
 * (300x56 pane, 2x screen, Chromium, CPU-throttled): a 2x map costs ~2.6x the
 * per-frame filter time of a 1x map for the same pane, because the filter
 * samples the map once per output pixel. The field is a smooth gradient, so a
 * 1x map upscales cleanly; only the 1px specular line softens to a 2px bevel,
 * which is closer to light than to a stroke.
 */
const MAP_DPR = 1;
/** Numerical step for the SDF gradient, in CSS px. */
const GRADIENT_STEP = 0.75;
/** Stop drawing the rim where its glow is this faint (exp(-4) ≈ 1.8%). */
const RIM_CUTOFF = 4;
/** Mid channel value of the 8-bit encoding, and its full scale. */
const CHANNEL_MID = 0.5;
const CHANNEL_MAX = 255;

const LIGHT_X = -Math.SQRT1_2;
const LIGHT_Y = -Math.SQRT1_2;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Signed distance to a rounded rect centred on the origin. Negative inside. */
function roundedRectSdf(
  x: number,
  y: number,
  halfWidth: number,
  halfHeight: number,
  radius: number,
): number {
  const qx = Math.abs(x) - halfWidth + radius;
  const qy = Math.abs(y) - halfHeight + radius;
  return (
    Math.min(Math.max(qx, qy), 0) +
    Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) -
    radius
  );
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function lengthOf(element: Element, name: string): number {
  const raw = getComputedStyle(element).getPropertyValue(name).trim();
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : Number.NaN;
}

/**
 * Read the profile from the element's computed style. A missing or malformed
 * token makes the whole profile invalid: the engine then leaves that element on
 * the blur fallback rather than drawing a lens from a half-known profile.
 */
export function readGlassOptics(element: HTMLElement): GlassOptics | null {
  const optics: GlassOptics = {
    band: lengthOf(element, '--glass-lens-band'),
    bandRatio: lengthOf(element, '--glass-lens-band-ratio'),
    depth: lengthOf(element, '--glass-lens-depth'),
    sizeRef: lengthOf(element, '--glass-lens-size-ref'),
    dispersion: lengthOf(element, '--glass-lens-dispersion'),
    bendPower: lengthOf(element, '--glass-lens-bend-power'),
    rimSharp: lengthOf(element, '--glass-lens-rim-sharp'),
    rimSoft: lengthOf(element, '--glass-lens-rim-soft'),
    rim: lengthOf(element, '--glass-lens-rim'),
    ambient: lengthOf(element, '--glass-lens-ambient'),
    facingPower: lengthOf(element, '--glass-lens-facing-power'),
    softShare: lengthOf(element, '--glass-lens-soft-share'),
    ring: lengthOf(element, '--glass-lens-ring'),
    ringCenter: lengthOf(element, '--glass-lens-ring-center'),
    ringWidth: lengthOf(element, '--glass-lens-ring-width'),
    margin: lengthOf(element, '--glass-lens-margin'),
    shift: lengthOf(element, '--glass-lens-shift'),
  };
  for (const value of Object.values(optics)) {
    if (!Number.isFinite(value) || value < 0) return null;
  }
  if (
    optics.band <= 0 ||
    optics.bandRatio <= 0 ||
    optics.depth <= 0 ||
    optics.sizeRef <= 0 ||
    optics.margin <= 0 ||
    optics.rimSharp <= 0 ||
    optics.rimSoft <= 0 ||
    optics.ringWidth <= 0
  ) {
    return null;
  }
  return optics;
}

/** The element's border box and its effective corner radius. */
export function measureGlass(element: HTMLElement): GlassGeometry | null {
  const rect = element.getBoundingClientRect();
  const width = Math.round(rect.width);
  const height = Math.round(rect.height);
  if (width <= 0 || height <= 0) return null;
  const style = getComputedStyle(element);
  const corner = Math.max(
    Number.parseFloat(style.borderTopLeftRadius) || 0,
    Number.parseFloat(style.borderTopRightRadius) || 0,
    Number.parseFloat(style.borderBottomLeftRadius) || 0,
    Number.parseFloat(style.borderBottomRightRadius) || 0,
  );
  return { width, height, radius: Math.min(corner, width / 2, height / 2) };
}

export interface DisplacementMap {
  url: string;
  /** The resolved band and depth after scaling for this pane's size. */
  band: number;
  depth: number;
}

/**
 * Draw the map. The canvas covers the element plus a neutral margin on every
 * side, and the filter places that margin outside the pane, so a motion shift
 * of up to `margin` px never pulls an empty strip into the lens.
 */
export function buildDisplacementMap(
  geometry: GlassGeometry,
  optics: GlassOptics,
): DisplacementMap | null {
  const dpr = MAP_DPR;
  const { width, height, radius } = geometry;
  const margin = optics.margin;
  const canvasWidth = Math.ceil((width + margin * 2) * dpr);
  const canvasHeight = Math.ceil((height + margin * 2) * dpr);
  const canvas = document.createElement('canvas');
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;
  const context = canvas.getContext('2d');
  if (!context) return null;
  const image = context.createImageData(canvasWidth, canvasHeight);
  const data = image.data;

  const halfWidth = width / 2;
  const halfHeight = height / 2;
  // A 44px button must not bend like a 300px pill: the bevel is capped to a
  // share of the short side, and the depth thins out below the reference size.
  const shortSide = Math.min(width, height);
  const halfBand = Math.min(optics.band, shortSide * optics.bandRatio);
  const depth = optics.depth * Math.min(1, shortSide / optics.sizeRef);
  const cutoff = Math.max(halfBand, optics.rimSoft * RIM_CUTOFF);

  for (let y = 0; y < canvasHeight; y++) {
    for (let x = 0; x < canvasWidth; x++) {
      const index = (y * canvasWidth + x) * 4;
      // Element-local coordinates, origin at the pane's centre.
      const ux = (x + 0.5) / dpr - margin - halfWidth;
      const uy = (y + 0.5) / dpr - margin - halfHeight;
      const distance = -roundedRectSdf(ux, uy, halfWidth, halfHeight, radius);
      if (distance <= 0 || distance > cutoff) {
        // Outside the shape, or too deep for the bend and the glow to reach:
        // neutral shift, no rim.
        data[index] = CHANNEL_MID * CHANNEL_MAX;
        data[index + 1] = CHANNEL_MID * CHANNEL_MAX;
        data[index + 2] = 0;
        data[index + 3] = CHANNEL_MAX;
        continue;
      }

      const step = GRADIENT_STEP;
      let nx =
        roundedRectSdf(ux + step, uy, halfWidth, halfHeight, radius) -
        roundedRectSdf(ux - step, uy, halfWidth, halfHeight, radius);
      let ny =
        roundedRectSdf(ux, uy + step, halfWidth, halfHeight, radius) -
        roundedRectSdf(ux, uy - step, halfWidth, halfHeight, radius);
      const normalLength = Math.hypot(nx, ny);
      if (normalLength > 0) {
        nx /= normalLength;
        ny /= normalLength;
      } else {
        nx = 0;
        ny = 0;
      }

      // The bend: strongest on the edge, gone by the middle of the pane.
      const bend = Math.pow(1 - smoothstep(0, halfBand, distance), optics.bendPower);
      // The specular: a sharp line on the edge, a softer bevel glow inside it,
      // and a uniform ring that the motion shift carries into the leading edge.
      const facing = clamp(nx * LIGHT_X + ny * LIGHT_Y, 0, 1);
      const directional = optics.ambient + (1 - optics.ambient) * Math.pow(facing, optics.facingPower);
      const line = Math.exp(-distance / optics.rimSharp);
      const soft = Math.exp(-distance / optics.rimSoft);
      const ring =
        Math.exp(-(((distance - optics.ringCenter) / optics.ringWidth) ** 2)) * optics.ring;
      const rim = clamp(
        (line * directional + soft * directional * optics.softShare + ring) * optics.rim,
        0,
        1,
      );

      data[index] = (CHANNEL_MID + nx * bend * CHANNEL_MID) * CHANNEL_MAX;
      data[index + 1] = (CHANNEL_MID + ny * bend * CHANNEL_MID) * CHANNEL_MAX;
      data[index + 2] = rim * CHANNEL_MAX;
      data[index + 3] = CHANNEL_MAX;
    }
  }

  context.putImageData(image, 0, 0);
  return { url: canvas.toDataURL(), band: halfBand, depth };
}
