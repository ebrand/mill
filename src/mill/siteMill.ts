// The style-test site's mill as a working structure: a head gate takes water from the pond
// at the flume's intake, the flume carries it to the breastshot wheel, and it falls into
// the wheel pit, which drains by the tailrace to the river.

import { FLUME, WHEEL } from '../scene/site';
import type { GridInfo } from '../water/protocol';
import type { Link } from '../water/shallowWater';
import { BREASTSHOT } from './wheel';

export const MILL_LINK_ID = 'mill-wheel';
/** Widest the head gate opens, m. */
export const GATE_MAX = 0.6;
/** Head lost along the flume to friction and at the gate, m (estimate). */
export const FLUME_LOSS = 0.1;

function cellsIn(grid: GridInfo, x0: number, x1: number, z0: number, z1: number): number[] {
  const out: number[] = [];
  for (let j = 0; j < grid.nz; j++) {
    const z = grid.z0 + (j + 0.5) * grid.dx;
    if (z < z0 || z > z1) continue;
    for (let i = 0; i < grid.nx; i++) {
      const x = grid.x0 + (i + 0.5) * grid.dx;
      if (x >= x0 && x <= x1) out.push(j * grid.nx + i);
    }
  }
  return out;
}

export function millLink(grid: GridInfo, opening: number): Link {
  return {
    id: MILL_LINK_ID,
    // Pond just upstream of the dam, in front of the flume.
    from: cellsIn(grid, FLUME.x0 - 2.5, FLUME.x0 - 0.5, FLUME.z - 1.0, FLUME.z + 1.0),
    // The wheel pit, downstream side of the wheel.
    to: cellsIn(grid, WHEEL.x + 0.5, WHEEL.x + 2.5, WHEEL.z - 1.0, WHEEL.z + 1.0),
    sill: FLUME.bottom,
    width: FLUME.halfWidth * 2 - 0.2,
    opening: Math.max(0, Math.min(GATE_MAX, opening)),
    maxDischarge: BREASTSHOT.maxDischarge,
  };
}
