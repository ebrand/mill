// Layout of the M0 style-test site: a valley, a river dammed into a millpond, and a stone
// mill with a breastshot wheel fed by a timber flume. Pure functions so tests can check the
// water actually sits where the drawing says it does.

/**
 * River falls 8 mm per meter toward +X: a lowland mill river. (M0 used 3 %, a torrent with
 * supercritical flow that the water solver isn't meant for.)
 */
export const RIVER_SLOPE = 0.008;
/** Mean river discharge entering upstream, m^3/s. */
export const RIVER_DISCHARGE = 12;
export const CHANNEL_HALF_WIDTH = 6;
export const CHANNEL_DEPTH = 1.8;
/** Approximate river depth at RIVER_DISCHARGE (Manning normal depth); the sim decides the real one. */
export const RIVER_DEPTH = 0.6;
/**
 * Where the river actually settles at RIVER_DISCHARGE, above riverBed(): measured from the sim
 * (1.14 m at every point along the reach). Used to start the river already flowing.
 */
export const STEADY_RIVER_STAGE = 1.14;
export const POND_LEVEL = 1.6;
export const DAM_X = 0;
export const SPILLWAY_HALF_WIDTH = 8;
export const SPILLWAY_CREST = 1.45;
export const DAM_TOP = 2.6;

/** World extent of the playable site (and the water sim). */
export const SITE_BOUNDS = { x0: -130, x1: 130, z0: -70, z1: 90 };

export const MILL = { x0: 8, x1: 30, z0: 14, z1: 26, base: -0.5, wallTop: 10.5, ridge: 15, wall: 0.6 };
export const WHEEL = { x: 12.5, y: 0.2, z: 11.6, radius: 2.4, width: 2.2 };
// Breastshot: the flume stops just short of the upstream side of the wheel.
export const FLUME = { x0: -1, x1: WHEEL.x - WHEEL.radius - 0.15, z: WHEEL.z, halfWidth: 1.2, bottom: 1.0, top: 1.95, water: 1.55 };
const PIT = { x0: WHEEL.x - 3, x1: WHEEL.x + 3, z0: WHEEL.z - 1.6, z1: WHEEL.z + 1.6, floor: -2.5 };
const TAILRACE = { x0: WHEEL.x + 1, x1: WHEEL.x + 3, floor: -1.9 };

export function riverCenter(x: number): number {
  return 6 * Math.sin(x * 0.025);
}

/** Valley floor beside the river, before the channel is cut. */
function valleyFloor(x: number, z: number): number {
  const dz = z - riverCenter(x);
  return -RIVER_SLOPE * x + Math.min(0.0035 * dz * dz, 14) + 0.6 * Math.sin(x * 0.11 + z * 0.07) * Math.min(Math.abs(dz) / 20, 1);
}

export function riverBed(x: number): number {
  return -RIVER_SLOPE * x - CHANNEL_DEPTH;
}

/** Which start a site is built for: the untouched valley, or the old mill demo. */
export type SiteStart = 'valley' | 'oldMill';

/** Terrain height; `works` carves the old mill's wheel pit and tailrace (demo start only). */
export function terrainHeight(x: number, z: number, works = true): number {
  const dz = z - riverCenter(x);
  let h = valleyFloor(x, z);
  const t = dz / CHANNEL_HALF_WIDTH;
  if (Math.abs(t) < 1.4) {
    const cut = CHANNEL_DEPTH * Math.max(0, 1 - t * t * 0.55);
    h = Math.min(h, -RIVER_SLOPE * x + 0.3 - cut);
  }
  if (!works) return h;
  // Wheel pit and tailrace dug down to below river level.
  if (x > PIT.x0 && x < PIT.x1 && z > PIT.z0 && z < PIT.z1) h = Math.min(h, PIT.floor);
  if (x > TAILRACE.x0 && x < TAILRACE.x1 && z < PIT.z1 && z > riverCenter(x)) h = Math.min(h, TAILRACE.floor);
  return h;
}

/** Water surface height upstream of the dam: river joins the millpond where the pond backs up. */
export function upstreamWaterLevel(x: number): number {
  return Math.max(POND_LEVEL, riverBed(x) + RIVER_DEPTH);
}

export function downstreamWaterLevel(x: number): number {
  return riverBed(x) + RIVER_DEPTH;
}

/** Current speed (m/s) for drawing; 0 in the pond. */
export function upstreamSpeed(x: number): number {
  const level = upstreamWaterLevel(x);
  return level > POND_LEVEL + 0.05 ? 1 : 0;
}

/** Head available at the wheel: pond level minus the tailrace (river) level there. */
export function headAtWheel(): number {
  return POND_LEVEL - downstreamWaterLevel(WHEEL.x);
}
