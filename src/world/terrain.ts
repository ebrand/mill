// Island terrain: one analytic height function, sampled onto a grid shared by the render
// mesh and the physics heightfield so the two can't drift apart.

function hash2(ix: number, iz: number, seed: number): number {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263) ^ Math.imul(seed, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function valueNoise(x: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz, seed);
  const b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed);
  const d = hash2(ix + 1, iz + 1, seed);
  return (a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz) * 2 - 1;
}

function fbm(x: number, z: number, octaves: number, seed: number): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise(x * freq, z * freq, seed + i * 17);
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum;
}

export const SEA_FLOOR = -38;

/** Terrain height in meters at world (x, z). Sea level is y = 0. */
export function islandHeight(x: number, z: number): number {
  // Warp the radius so the coastline isn't a circle.
  const warp = fbm(x * 0.012, z * 0.012, 3, 7) * 28;
  const r = Math.hypot(x, z) + warp;
  const t = r / 95;
  const core = Math.exp(-t * t * 2.4);
  // A wide shallow shelf so there's turquoise water around the beach.
  const shelf = Math.exp(-t * t * 0.55);
  const detail = fbm(x * 0.04, z * 0.04, 4, 3) * 3.5 * core;
  return SEA_FLOOR + 22 * shelf + 40 * core + detail;
}

export interface TerrainGrid {
  /** Samples per side. */
  resolution: number;
  /** World size per side in meters; grid is centered on the origin. */
  size: number;
  /** Row-major: heights[iz * resolution + ix]. */
  heights: Float32Array;
}

export function sampleTerrain(size = 640, resolution = 257): TerrainGrid {
  const heights = new Float32Array(resolution * resolution);
  const step = size / (resolution - 1);
  const half = size / 2;
  for (let iz = 0; iz < resolution; iz++) {
    for (let ix = 0; ix < resolution; ix++) {
      heights[iz * resolution + ix] = islandHeight(-half + ix * step, -half + iz * step);
    }
  }
  return { resolution, size, heights };
}

/**
 * Rapier wants a column-major matrix where rows run along Z and columns along X.
 * Verified against islandHeight by raycasting in tests/terrain.test.ts.
 */
export function toRapierHeights(grid: TerrainGrid): Float32Array {
  const n = grid.resolution;
  const out = new Float32Array(n * n);
  for (let ix = 0; ix < n; ix++) {
    for (let iz = 0; iz < n; iz++) {
      out[ix * n + iz] = grid.heights[iz * n + ix];
    }
  }
  return out;
}
