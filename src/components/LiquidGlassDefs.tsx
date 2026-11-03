/*
  The refraction filter behind .liquid-glass (glass.css): one hidden inline
  <svg>, rendered once in App. `#lg-refract` bends the backdrop with a low
  frequency noise through a displacement map, then softens the result a hair
  so the bend reads as glass, not as noise. Where the browser cannot run an SVG
  filter as a backdrop filter, glass.css never references it. Zero size and
  absolutely positioned, not display:none (a display:none <svg> drops its filters).
*/
import type { JSX } from 'react';

/** Filter numbers: simulation constants of the refraction, not design values. */
const noiseFrequency = '0.012 0.018';
const noiseOctaves = 2;
const noiseSeed = 7;
const bendScale = 14;
const softness = 0.6;

export function LiquidGlassDefs(): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width="0"
      height="0"
      className="pointer-events-none absolute size-0 overflow-hidden"
    >
      <defs>
        <filter id="lg-refract" x="0%" y="0%" width="100%" height="100%" colorInterpolationFilters="sRGB">
          <feTurbulence
            type="fractalNoise"
            baseFrequency={noiseFrequency}
            numOctaves={noiseOctaves}
            seed={noiseSeed}
            result="noise"
          />
          <feGaussianBlur in="noise" stdDeviation={softness} result="smooth" />
          <feDisplacementMap in="SourceGraphic" in2="smooth" scale={bendScale} xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </defs>
    </svg>
  );
}
