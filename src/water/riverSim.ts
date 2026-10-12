// Builds the shallow-water sim for the style-test site: bed from the terrain, the dam as
// weirs, inflow into the river channel upstream, free outflow downstream.

import {
  CHANNEL_HALF_WIDTH,
  DAM_TOP,
  DAM_X,
  MILL,
  POND_LEVEL,
  RIVER_DEPTH,
  RIVER_DISCHARGE,
  RIVER_SLOPE,
  riverBed,
  riverCenter,
  SPILLWAY_CREST,
  SPILLWAY_HALF_WIDTH,
} from '../scene/site';
import { createSiteField } from '../world/siteField';
import type { FieldSpec } from '../world/terrainField';
import { ShallowWater } from './shallowWater';
/** The dam's abutments run this far beyond the spillway on each side (matches buildSite). */
const ABUTMENT_LENGTH = 26;

export interface RiverSimOptions {
  /** Cell size in meters (used when no terrain is given). */
  dx: number;
  discharge?: number;
  /** Start with water near steady state (true) or dry (false). */
  prefill?: boolean;
  /** Terrain to build on; defaults to the generated site at `dx`. */
  terrain?: { spec: FieldSpec; heights: Float32Array };
}

/**
 * Extra bed height from solid structures (the mill), added on top of the terrain. Kept
 * separate so terrain edits can be applied without losing it.
 */
export function structureOffset(spec: FieldSpec): Float32Array {
  const out = new Float32Array(spec.nx * spec.nz);
  for (let j = 0; j < spec.nz; j++) {
    const z = spec.z0 + (j + 0.5) * spec.dx;
    for (let i = 0; i < spec.nx; i++) {
      const x = spec.x0 + (i + 0.5) * spec.dx;
      if (x > MILL.x0 && x < MILL.x1 && z > MILL.z0 && z < MILL.z1) out[j * spec.nx + i] = 20;
    }
  }
  return out;
}

export function buildRiverSim({ dx, discharge = RIVER_DISCHARGE, prefill = true, terrain }: RiverSimOptions): ShallowWater {
  const t = terrain ?? (() => {
    const f = createSiteField(dx);
    return { spec: f.spec, heights: f.heights };
  })();
  const { nx, nz, x0, z0 } = t.spec;
  dx = t.spec.dx;
  const offset = structureOffset(t.spec);
  const bed = new Float64Array(nx * nz);
  for (let k = 0; k < bed.length; k++) bed[k] = t.heights[k] + offset[k];
  const sim = new ShallowWater({ nx, nz, dx, x0, z0 }, bed);

  // The dam: a thin wall on the x-edge at DAM_X. Spillway in the channel, abutments (which
  // only pass water if overtopped) out to the banks.
  const damEdge = Math.round((DAM_X - x0) / dx);
  const c = riverCenter(DAM_X);
  for (let j = 0; j < nz; j++) {
    const dz = Math.abs(z0 + (j + 0.5) * dx - c);
    if (dz < SPILLWAY_HALF_WIDTH) {
      sim.addWeir({ axis: 'x', edge: j * (nx + 1) + damEdge, crest: SPILLWAY_CREST, coefficient: 1.7 });
    } else if (dz < SPILLWAY_HALF_WIDTH + ABUTMENT_LENGTH) {
      sim.addWeir({ axis: 'x', edge: j * (nx + 1) + damEdge, crest: DAM_TOP, coefficient: 1.5 });
    }
  }

  // Inflow enters across the river channel at the upstream edge.
  const cIn = riverCenter(x0);
  const rows: number[] = [];
  for (let j = 0; j < nz; j++) if (Math.abs(z0 + (j + 0.5) * dx - cIn) < CHANNEL_HALF_WIDTH) rows.push(j);
  sim.inflow = { rows, discharge };
  sim.outflow = { slope: RIVER_SLOPE };

  if (prefill) {
    // Pond a little above the spillway crest; river below the dam at about normal depth.
    const pond = POND_LEVEL + 0.25;
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const x = x0 + (i + 0.5) * dx;
        const target = x < DAM_X ? pond : riverBed(x) + RIVER_DEPTH;
        const k = j * nx + i;
        sim.depth[k] = Math.max(0, target - bed[k]);
      }
    }
  }
  return sim;
}
