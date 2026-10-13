// The style-test site's mill as a working structure: a head gate takes water from the pond
// at the flume's intake, the flume carries it to the breastshot wheel, and it falls into
// the wheel pit, which drains by the tailrace to the river.

import { FLUME, WHEEL } from '../scene/site';
import type { GridInfo } from '../water/protocol';
import type { Link } from '../water/shallowWater';
import { type Structure, structureLink } from './structures';

export const MILL_LINK_ID = 'mill-wheel';
/** Widest the head gate opens, m. */
export const GATE_MAX = 0.6;
/** Head lost along the flume to friction and at the gate, m (estimate). */
export const FLUME_LOSS = 0.1;

/** The original mill on the site, as a structure: its flume intake and wheel pit. */
export function siteMillStructure(opening = 0.25, lumber = 0): Structure {
  return {
    id: MILL_LINK_ID,
    kind: 'wheel',
    name: 'The old mill',
    intake: { x: FLUME.x0 - 1.5, z: FLUME.z },
    outlet: { x: WHEEL.x + 1.5, z: WHEEL.z },
    width: FLUME.halfWidth * 2 - 0.2,
    sill: FLUME.bottom,
    opening,
    maxOpening: GATE_MAX,
    lumber,
    builtIn: true,
    areas: {
      // Pond just upstream of the dam, in front of the flume.
      intake: [FLUME.x0 - 2.5, FLUME.x0 - 0.5, FLUME.z - 1.0, FLUME.z + 1.0],
      // The wheel pit, downstream side of the wheel.
      outlet: [WHEEL.x + 0.5, WHEEL.x + 2.5, WHEEL.z - 1.0, WHEEL.z + 1.0],
    },
  };
}

export function millLink(grid: GridInfo, opening: number): Link {
  return structureLink(grid, siteMillStructure(opening));
}
