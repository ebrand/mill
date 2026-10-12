// Procedural pen-and-ink strokes in TSL. Strokes are anchored to surfaces (world-space
// coordinates), not the screen, so they don't swim when the camera moves. Spacing is kept
// near a target on-screen size by blending between power-of-two world spacings, the same
// idea as mipmapping: zooming out fades every other line instead of turning the surface grey.

import {
  abs,
  clamp,
  cos,
  dot,
  exp2,
  float,
  floor,
  fract,
  fwidth,
  log2,
  max,
  mx_noise_float,
  sin,
  smoothstep,
  vec2,
  vec3,
} from 'three/tsl';

export type Node = any; // TSL's typings are too loose to be worth fighting here.

export interface LineOptions {
  /** World spacing at the finest level, in meters. */
  base: number;
  /** Desired on-screen spacing in pixels. */
  targetPx: number;
  /** Stroke width in pixels (node or number). */
  widthPx: Node;
}

/**
 * Coverage (0..1) of a family of parallel lines crossing `axis` (unit vec2) in the 2D
 * surface coordinates `coord` (meters).
 */
export function lineFamily(coord: Node, axis: Node, { base, targetPx, widthPx }: LineOptions): Node {
  const d = dot(coord, axis);
  const metersPerPx = max(fwidth(d), 1e-6);
  const level = log2(metersPerPx.mul(targetPx).div(base));
  const lod = max(floor(level), 0);
  const blend = clamp(level.sub(lod), 0, 1);
  const s0 = exp2(lod).mul(base);
  const halfWidth = float(widthPx).mul(0.5);

  const line = (spacing: Node) => {
    const distPx = abs(fract(d.div(spacing).add(0.5)).sub(0.5)).mul(spacing).div(metersPerPx);
    return float(1).sub(smoothstep(halfWidth.sub(0.5), halfWidth.add(0.5), distPx));
  };

  // Coarse lines are a subset of fine ones, so fading the fine set out is seamless.
  return max(line(s0.mul(2)), line(s0).mul(float(1).sub(blend)));
}

export function dir(angle: number): Node {
  return vec2(Math.cos(angle), Math.sin(angle));
}

/** Small world-anchored distortion so lines aren't ruler-straight. */
export function wobble(coord: Node, world: Node, amount = 0.04): Node {
  const n1 = mx_noise_float(world.mul(0.9));
  const n2 = mx_noise_float(world.mul(0.9).add(vec3(17.3, 5.1, 9.7)));
  return coord.add(vec2(n1, n2).mul(amount));
}

/**
 * Tonal hatching: more line families appear as the surface gets darker, and strokes
 * thicken. tone is roughly 0 (black) .. 1 (paper).
 */
export function hatch(tone: Node, coord: Node, angle = 0.8, start = 0.9): Node {
  const dark = clamp(float(1).sub(tone), 0, 1);
  const width = dark.mul(1.1).add(0.7);
  const l1 = lineFamily(coord, dir(angle), { base: 0.08, targetPx: 7, widthPx: width }).mul(smoothstep(start, start - 0.18, tone));
  const l2 = lineFamily(coord, dir(angle + Math.PI / 2), { base: 0.08, targetPx: 7, widthPx: width }).mul(
    smoothstep(start - 0.35, start - 0.5, tone),
  );
  const l3 = lineFamily(coord, dir(angle + 0.45), { base: 0.06, targetPx: 5, widthPx: width }).mul(smoothstep(start - 0.58, start - 0.72, tone));
  return max(max(l1, l2), l3);
}

/** Rotate 2D coordinates; used to vary stroke direction per surface. */
export function rotate(coord: Node, angle: Node): Node {
  const c = cos(angle);
  const s = sin(angle);
  return vec2(coord.x.mul(c).sub(coord.y.mul(s)), coord.x.mul(s).add(coord.y.mul(c)));
}
