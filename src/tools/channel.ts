// Channel design: a centerline through control points, a trapezoidal section with a falling
// bed, and banks where the ground is too low to hold the water. Pure functions so the
// geometry, volumes and capacity can be tested headless.

import type { Rect, TerrainField } from '../world/terrainField';

export interface ChannelPlan {
  /** Control points in world XZ (at least two). */
  points: { x: number; z: number }[];
  /** Width of the channel bottom, m. */
  bottomWidth: number;
  /** Side slope, horizontal per vertical (1.5 is typical for earth banks). */
  sideSlope: number;
  /** Bed fall per meter along the centerline (0.001 = 1 in 1000). */
  bedSlope: number;
  /** Bed elevation at the first control point, m. */
  startBed: number;
  /** Design water depth, m. Banks are built to this plus freeboard. */
  depth: number;
  /** Height of the bank top above design water level, m. */
  freeboard: number;
  /** Width of the flat bank top, m. */
  crestWidth: number;
}

export const DEFAULT_PLAN: Omit<ChannelPlan, 'points' | 'startBed'> = {
  bottomWidth: 3,
  sideSlope: 1.5,
  bedSlope: 0.001,
  depth: 1.0,
  freeboard: 0.4,
  crestWidth: 1.5,
};

export interface Centerline {
  x: Float64Array;
  z: Float64Array;
  /** Arc length at each vertex. */
  s: Float64Array;
  length: number;
}

/** Centripetal Catmull-Rom through the points, sampled every ~`spacing` meters. */
export function centerline(points: { x: number; z: number }[], spacing = 0.5): Centerline {
  if (points.length < 2) throw new Error('a channel needs at least two points');
  const xs: number[] = [];
  const zs: number[] = [];
  const P = [points[0], ...points, points[points.length - 1]];
  for (let k = 1; k < P.length - 2; k++) {
    const p0 = P[k - 1];
    const p1 = P[k];
    const p2 = P[k + 1];
    const p3 = P[k + 2];
    const segLen = Math.hypot(p2.x - p1.x, p2.z - p1.z);
    const n = Math.max(1, Math.ceil(segLen / spacing));
    // Centripetal parameterisation avoids cusps and self-intersections.
    const t0 = 0;
    const t1 = t0 + Math.sqrt(Math.max(Math.hypot(p1.x - p0.x, p1.z - p0.z), 1e-6));
    const t2 = t1 + Math.sqrt(Math.max(segLen, 1e-6));
    const t3 = t2 + Math.sqrt(Math.max(Math.hypot(p3.x - p2.x, p3.z - p2.z), 1e-6));
    for (let i = 0; i < n; i++) {
      const t = t1 + ((t2 - t1) * i) / n;
      const lerp = (a: number, b: number, ta: number, tb: number) => ((tb - t) * a + (t - ta) * b) / (tb - ta);
      const a1x = lerp(p0.x, p1.x, t0, t1), a1z = lerp(p0.z, p1.z, t0, t1);
      const a2x = lerp(p1.x, p2.x, t1, t2), a2z = lerp(p1.z, p2.z, t1, t2);
      const a3x = lerp(p2.x, p3.x, t2, t3), a3z = lerp(p2.z, p3.z, t2, t3);
      const b1x = lerp(a1x, a2x, t0, t2), b1z = lerp(a1z, a2z, t0, t2);
      const b2x = lerp(a2x, a3x, t1, t3), b2z = lerp(a2z, a3z, t1, t3);
      xs.push(lerp(b1x, b2x, t1, t2));
      zs.push(lerp(b1z, b2z, t1, t2));
    }
  }
  const last = points[points.length - 1];
  xs.push(last.x);
  zs.push(last.z);
  const s = new Float64Array(xs.length);
  for (let i = 1; i < xs.length; i++) s[i] = s[i - 1] + Math.hypot(xs[i] - xs[i - 1], zs[i] - zs[i - 1]);
  return { x: Float64Array.from(xs), z: Float64Array.from(zs), s, length: s[s.length - 1] };
}

/** Distance from (px, pz) to the centerline and the arc length of the nearest point. */
export function nearest(line: Centerline, px: number, pz: number): { d: number; s: number } {
  let best = Infinity;
  let bestS = 0;
  for (let i = 0; i < line.x.length - 1; i++) {
    const ax = line.x[i], az = line.z[i];
    const bx = line.x[i + 1], bz = line.z[i + 1];
    const dx = bx - ax, dz = bz - az;
    const len2 = dx * dx + dz * dz;
    const t = len2 > 0 ? Math.min(1, Math.max(0, ((px - ax) * dx + (pz - az) * dz) / len2)) : 0;
    const qx = ax + dx * t - px, qz = az + dz * t - pz;
    const d2 = qx * qx + qz * qz;
    if (d2 < best) {
      best = d2;
      bestS = line.s[i] + (line.s[i + 1] - line.s[i]) * t;
    }
  }
  return { d: Math.sqrt(best), s: bestS };
}

export function bedAt(plan: ChannelPlan, s: number): number {
  return plan.startBed - plan.bedSlope * s;
}

/**
 * Ground height the channel wants at distance d from the centerline, given the ground
 * there now: cut to the channel section and its side slopes, build banks where the ground
 * is too low, leave it alone elsewhere.
 */
export function shapeGround(plan: ChannelPlan, bed: number, d: number, ground: number): number {
  const half = plan.bottomWidth / 2;
  const m = plan.sideSlope;
  if (d <= half) return Math.min(ground, bed);
  const bankTop = bed + plan.depth + plan.freeboard;
  const slopeEnd = half + (bankTop - bed) * m;
  const crestEnd = slopeEnd + plan.crestWidth;
  // Cut template: inner side slope, carried on up into any higher ground.
  const cutTo = bed + (d - half) / m;
  // Bank template: inner slope up to the bank top, the crest, then the outer slope down.
  const bank = d <= slopeEnd ? cutTo : d <= crestEnd ? bankTop : bankTop - (d - crestEnd) / m;
  return Math.min(Math.max(ground, bank), cutTo);
}

export interface ChannelResult {
  rect: Rect;
  /** New heights for `rect`, row-major. */
  heights: Float32Array;
  cut: number;
  fill: number;
  line: Centerline;
  /** Bed fall from start to end, m. */
  fall: number;
}

/** Work out the earthworks for a plan without touching the field. */
export function planChannel(field: TerrainField, plan: ChannelPlan, maxReach = 30): ChannelResult {
  const line = centerline(plan.points, field.dx);
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < line.x.length; i++) {
    minX = Math.min(minX, line.x[i]);
    maxX = Math.max(maxX, line.x[i]);
    minZ = Math.min(minZ, line.z[i]);
    maxZ = Math.max(maxZ, line.z[i]);
  }
  const reach = Math.min(maxReach, plan.bottomWidth / 2 + (plan.depth + plan.freeboard) * plan.sideSlope * 2 + plan.crestWidth + 6);
  const i0 = Math.max(0, Math.floor((minX - reach - field.x0) / field.dx));
  const i1 = Math.min(field.nx, Math.ceil((maxX + reach - field.x0) / field.dx));
  const j0 = Math.max(0, Math.floor((minZ - reach - field.z0) / field.dx));
  const j1 = Math.min(field.nz, Math.ceil((maxZ + reach - field.z0) / field.dx));
  const w = i1 - i0;
  const heights = new Float32Array(w * (j1 - j0));
  const area = field.dx * field.dx;
  let cut = 0;
  let fill = 0;
  for (let j = j0; j < j1; j++) {
    for (let i = i0; i < i1; i++) {
      const k = j * field.nx + i;
      const ground = field.heights[k];
      const { d, s } = nearest(line, field.sampleX(i), field.sampleZ(j));
      const h = d > reach ? ground : shapeGround(plan, bedAt(plan, s), d, ground);
      heights[(j - j0) * w + (i - i0)] = h;
      const delta = h - ground;
      if (delta < 0) cut -= delta * area;
      else fill += delta * area;
    }
  }
  return { rect: { i0, j0, i1, j1 }, heights, cut, fill, line, fall: plan.bedSlope * line.length };
}

/** Write a rectangle of planned heights (row-major) into the field. */
export function writeHeights(field: TerrainField, rect: Rect, heights: Float32Array): void {
  const w = rect.i1 - rect.i0;
  for (let j = rect.j0; j < rect.j1; j++) {
    for (let i = rect.i0; i < rect.i1; i++) field.heights[j * field.nx + i] = heights[(j - rect.j0) * w + (i - rect.i0)];
  }
}

/** Write a planned channel into the field. */
export function applyChannel(field: TerrainField, result: ChannelResult): void {
  writeHeights(field, result.rect, result.heights);
}

/** Manning discharge of a trapezoidal channel flowing at `depth`, m^3/s. */
export function manningCapacity(bottomWidth: number, sideSlope: number, depth: number, bedSlope: number, n = 0.035): number {
  const area = depth * (bottomWidth + sideSlope * depth);
  const wetted = bottomWidth + 2 * depth * Math.sqrt(1 + sideSlope * sideSlope);
  return (area * Math.pow(area / wetted, 2 / 3) * Math.sqrt(bedSlope)) / n;
}
