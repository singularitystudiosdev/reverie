/*
  filter.ts: the SVG filter one pane wears. It is generated per element because
  the displacement map is that element's own geometry (see geometry.ts); a
  single shared filter cannot know a 300x56 pill from a 44x44 button.

  The graph, in order:
    feImage     the map, drawn at the pane's size (plus its neutral margin)
    feOffset    the motion shift: moves the whole field (and the rim ring) by
                --glass-x / --glass-y, in the opposite direction, so the ring
                comes to rest just inside the leading edge
    feDisplacementMap x2  one pass a hair tighter, one a hair wider than the
                nominal scale. Red comes from the tight pass, green+blue from
                the wide one; feBlend screen recombines them. In the flat middle
                both passes sample the same pixel, so the screen of a red-only
                and a green+blue-only layer is the original image exactly (the
                channels are complements); only the bent rim separates them.
                That is the 1-2px chromatic fringe, made of the same light as
                the pane rather than painted as a coloured line.
    feColorMatrix + feComposite  the map's B channel is alpha over a white
                plate, composited over the refracted backdrop: the specular
                rim. It is brightest where the bevel normal faces the light
                (top left) because the map already baked that in.

  Everything runs in sRGB so the PNG's channel values are the numbers we wrote.
*/

import type { GlassGeometry, GlassOptics } from './geometry';

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
/** feDisplacementMap scale is twice the encoded vector's half-range. */
const SCALE_FACTOR = 2;
const RED = '1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0';
const GREEN_BLUE = '0 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 1 0';
const WHITE_FROM_BLUE_ALPHA = '0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 1 0 0';

export interface GlassFilterHandle {
  readonly id: string;
  /** Shift the field by a signed CSS-pixel pair (the pane's motion). */
  setShift(x: number, y: number): void;
  destroy(): void;
}

function svg(name: string, attributes: Record<string, string | number>): SVGElement {
  const element = document.createElementNS(SVG_NAMESPACE, name);
  for (const [key, value] of Object.entries(attributes)) {
    element.setAttribute(key, String(value));
  }
  return element;
}

export function createGlassFilter(
  defs: SVGElement,
  id: string,
  geometry: GlassGeometry,
  optics: GlassOptics,
  mapUrl: string,
  depth: number,
): GlassFilterHandle {
  const { width, height } = geometry;
  const margin = optics.margin;
  const filter = svg('filter', {
    id,
    filterUnits: 'userSpaceOnUse',
    x: 0,
    y: 0,
    width,
    height,
    'color-interpolation-filters': 'sRGB',
  });

  const map = svg('feImage', {
    x: -margin,
    y: -margin,
    width: width + margin * 2,
    height: height + margin * 2,
    preserveAspectRatio: 'none',
    result: 'map',
  });
  map.setAttribute('href', mapUrl);
  filter.append(map);

  const offset = svg('feOffset', { in: 'map', dx: 0, dy: 0, result: 'mapMoved' });
  filter.append(offset);

  const scale = depth * SCALE_FACTOR;
  filter.append(
    svg('feDisplacementMap', {
      in: 'SourceGraphic',
      in2: 'mapMoved',
      scale: scale * (1 - optics.dispersion),
      xChannelSelector: 'R',
      yChannelSelector: 'G',
      result: 'redBend',
    }),
    svg('feColorMatrix', {
      in: 'redBend',
      type: 'matrix',
      values: RED,
      result: 'red',
    }),
    svg('feDisplacementMap', {
      in: 'SourceGraphic',
      in2: 'mapMoved',
      scale: scale * (1 + optics.dispersion),
      xChannelSelector: 'R',
      yChannelSelector: 'G',
      result: 'greenBlueBend',
    }),
    svg('feColorMatrix', {
      in: 'greenBlueBend',
      type: 'matrix',
      values: GREEN_BLUE,
      result: 'greenBlue',
    }),
    svg('feBlend', { in: 'red', in2: 'greenBlue', mode: 'screen', result: 'bent' }),
    svg('feColorMatrix', {
      in: 'mapMoved',
      type: 'matrix',
      values: WHITE_FROM_BLUE_ALPHA,
      result: 'rim',
    }),
    svg('feComposite', { in: 'rim', in2: 'bent', operator: 'over' }),
  );

  defs.append(filter);

  return {
    id,
    setShift(x: number, y: number): void {
      // Opposite the motion: see the feOffset note in the header.
      offset.setAttribute('dx', (-x).toFixed(2));
      offset.setAttribute('dy', (-y).toFixed(2));
    },
    destroy(): void {
      filter.remove();
    },
  };
}
