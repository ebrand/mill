// Spillways: a weir crest across a channel, built from the sim's weir edges (thin walls with
// Q = C L H^1.5 over them). A crest line becomes the grid edges whose two cells lie on
// opposite sides of it, which makes a watertight staircase wall.

import type { GridInfo } from '../water/protocol';
import type { Weir } from '../water/shallowWater';

/** Discharge coefficient for a timber crib or masonry crest, SI (estimate: broad-crested). */
export const SPILLWAY_C = 1.7;

/** Does segment p-q cross segment a-b (strictly)? */
function crosses(px: number, pz: number, qx: number, qz: number, ax: number, az: number, bx: number, bz: number): boolean {
  const d1 = (bx - ax) * (pz - az) - (bz - az) * (px - ax);
  const d2 = (bx - ax) * (qz - az) - (bz - az) * (qx - ax);
  const d3 = (qx - px) * (az - pz) - (qz - pz) * (ax - px);
  const d4 = (qx - px) * (bz - pz) - (qz - pz) * (bx - px);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/**
 * The weir edges for a crest from a to b. On a diagonal the staircase of edges is longer than
 * the crest itself, so the coefficient is scaled by true length / staircase length.
 */
export function spillwayWeirs(grid: GridInfo, a: { x: number; z: number }, b: { x: number; z: number }, crest: number, coefficient = SPILLWAY_C): Weir[] {
  const { nx, nz, dx, x0, z0 } = grid;
  const cx = (i: number) => x0 + (i + 0.5) * dx;
  const cz = (j: number) => z0 + (j + 0.5) * dx;
  const i0 = Math.max(0, Math.floor((Math.min(a.x, b.x) - x0) / dx) - 1);
  const i1 = Math.min(nx - 1, Math.ceil((Math.max(a.x, b.x) - x0) / dx) + 1);
  const j0 = Math.max(0, Math.floor((Math.min(a.z, b.z) - z0) / dx) - 1);
  const j1 = Math.min(nz - 1, Math.ceil((Math.max(a.z, b.z) - z0) / dx) + 1);
  const edges: Omit<Weir, 'coefficient'>[] = [];
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      // x-edge between (i-1, j) and (i, j): index j * (nx + 1) + i.
      if (i > 0 && crosses(cx(i - 1), cz(j), cx(i), cz(j), a.x, a.z, b.x, b.z)) edges.push({ axis: 'x', edge: j * (nx + 1) + i, crest });
      // z-edge between (i, j-1) and (i, j): index j * nx + i.
      if (j > 0 && crosses(cx(i), cz(j - 1), cx(i), cz(j), a.x, a.z, b.x, b.z)) edges.push({ axis: 'z', edge: j * nx + i, crest });
    }
  }
  const length = Math.hypot(b.x - a.x, b.z - a.z);
  const staircase = edges.length * dx;
  const scale = staircase > 0 ? Math.min(1, length / staircase) : 1;
  return edges.map((e) => ({ ...e, coefficient: coefficient * scale }));
}

/** Head over a crest of length L passing discharge Q, and so the pond level behind it. */
export function headOverCrest(discharge: number, length: number, coefficient = SPILLWAY_C): number {
  if (discharge <= 0 || length <= 0) return 0;
  return Math.pow(discharge / (coefficient * length), 2 / 3);
}

/**
 * Length of crest that water can actually pass: where the ground under the crest line is
 * below the crest. Bank ends and high ground at either side close part of a crest off.
 */
export function openCrestLength(heightAt: (x: number, z: number) => number, a: { x: number; z: number }, b: { x: number; z: number }, crest: number, step = 0.25): number {
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  const n = Math.max(1, Math.ceil(len / step));
  let open = 0;
  for (let k = 0; k < n; k++) {
    const t = (k + 0.5) / n;
    if (heightAt(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t) < crest) open += len / n;
  }
  return open;
}
