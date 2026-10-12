// Embankments: earth banks and dams along a centerline. Fill only; the crest is level.
// Pure functions, like channel.ts, so geometry and volumes are tested headless.

import type { Rect, TerrainField } from '../world/terrainField';
import { type Centerline, centerline, nearest } from './channel';

export interface EmbankmentPlan {
  points: { x: number; z: number }[];
  /** Crest elevation, m. */
  crest: number;
  /** Width of the flat top, m. */
  crestWidth: number;
  /** Side slope, horizontal per vertical. Earth dams were often 2:1 or flatter. */
  sideSlope: number;
}

export const DEFAULT_EMBANKMENT: Omit<EmbankmentPlan, 'points' | 'crest'> = {
  crestWidth: 2,
  sideSlope: 2,
};

/** Ground height after building the bank, at distance d from its centerline. */
export function shapeBank(plan: EmbankmentPlan, d: number, ground: number): number {
  const half = plan.crestWidth / 2;
  const top = d <= half ? plan.crest : plan.crest - (d - half) / plan.sideSlope;
  return Math.max(ground, top);
}

export interface EmbankmentResult {
  rect: Rect;
  heights: Float32Array;
  fill: number;
  line: Centerline;
  /** Greatest height of the crest above the original ground along the line, m. */
  maxHeight: number;
  /** Lowest original ground along the centerline, m. */
  lowestGround: number;
}

export function planEmbankment(field: TerrainField, plan: EmbankmentPlan): EmbankmentResult {
  const line = centerline(plan.points, field.dx);
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  let lowestGround = Infinity;
  for (let i = 0; i < line.x.length; i++) {
    minX = Math.min(minX, line.x[i]);
    maxX = Math.max(maxX, line.x[i]);
    minZ = Math.min(minZ, line.z[i]);
    maxZ = Math.max(maxZ, line.z[i]);
    lowestGround = Math.min(lowestGround, field.heightAt(line.x[i], line.z[i]));
  }
  const maxHeight = Math.max(0, plan.crest - lowestGround);
  // Far enough for the toe of the tallest section.
  const reach = plan.crestWidth / 2 + maxHeight * plan.sideSlope + field.dx * 2;
  const i0 = Math.max(0, Math.floor((minX - reach - field.x0) / field.dx));
  const i1 = Math.min(field.nx, Math.ceil((maxX + reach - field.x0) / field.dx));
  const j0 = Math.max(0, Math.floor((minZ - reach - field.z0) / field.dx));
  const j1 = Math.min(field.nz, Math.ceil((maxZ + reach - field.z0) / field.dx));
  const w = i1 - i0;
  const heights = new Float32Array(w * (j1 - j0));
  const area = field.dx * field.dx;
  let fill = 0;
  for (let j = j0; j < j1; j++) {
    for (let i = i0; i < i1; i++) {
      const ground = field.heights[j * field.nx + i];
      const { d } = nearest(line, field.sampleX(i), field.sampleZ(j));
      const h = d > reach ? ground : shapeBank(plan, d, ground);
      heights[(j - j0) * w + (i - i0)] = h;
      fill += (h - ground) * area;
    }
  }
  return { rect: { i0, j0, i1, j1 }, heights, fill, line, maxHeight, lowestGround };
}
