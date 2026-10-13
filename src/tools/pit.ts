import type { Rect, TerrainField } from '../world/terrainField';

export interface PitResult {
  rect: Rect;
  heights: Float32Array;
  cut: number;
}

/**
 * A rectangular pit along the line from `a` to `b`, from `start` m past `a` to `b`, `width`
 * wide, floored at `floor` (only lowers ground). Side walls are vertical; it's timbered.
 */
export function planPit(
  field: TerrainField,
  a: { x: number; z: number },
  b: { x: number; z: number },
  start: number,
  width: number,
  floor: number,
): PitResult {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dz) || 1;
  const ux = dx / len;
  const uz = dz / len;
  const reach = len + width;
  const i0 = Math.max(0, Math.floor((Math.min(a.x, b.x) - width - field.x0) / field.dx));
  const i1 = Math.min(field.nx, Math.ceil((Math.max(a.x, b.x) + width - field.x0) / field.dx));
  const j0 = Math.max(0, Math.floor((Math.min(a.z, b.z) - width - field.z0) / field.dx));
  const j1 = Math.min(field.nz, Math.ceil((Math.max(a.z, b.z) + width - field.z0) / field.dx));
  const w = i1 - i0;
  const heights = new Float32Array(w * (j1 - j0));
  let cut = 0;
  for (let j = j0; j < j1; j++) {
    for (let i = i0; i < i1; i++) {
      const px = field.sampleX(i) - a.x;
      const pz = field.sampleZ(j) - a.z;
      const along = px * ux + pz * uz;
      const across = Math.abs(-px * uz + pz * ux);
      const ground = field.heights[j * field.nx + i];
      const inPit = along >= start && along <= len && across <= width / 2 && along <= reach;
      const h = inPit ? Math.min(ground, floor) : ground;
      heights[(j - j0) * w + (i - i0)] = h;
      cut += (ground - h) * field.dx * field.dx;
    }
  }
  return { rect: { i0, j0, i1, j1 }, heights, cut };
}
