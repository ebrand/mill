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
  terrainHeight,
} from '../scene/site';
import { ShallowWater } from './shallowWater';

export const SITE_BOUNDS = { x0: -130, x1: 130, z0: -70, z1: 90 };
/** The dam's abutments run this far beyond the spillway on each side (matches buildSite). */
const ABUTMENT_LENGTH = 26;

export interface RiverSimOptions {
  /** Cell size in meters. */
  dx: number;
  discharge?: number;
  /** Start with water near steady state (true) or dry (false). */
  prefill?: boolean;
}

export function buildRiverSim({ dx, discharge = RIVER_DISCHARGE, prefill = true }: RiverSimOptions): ShallowWater {
  const { x0, x1, z0, z1 } = SITE_BOUNDS;
  const nx = Math.round((x1 - x0) / dx);
  const nz = Math.round((z1 - z0) / dx);
  const bed = new Float64Array(nx * nz);
  for (let j = 0; j < nz; j++) {
    const z = z0 + (j + 0.5) * dx;
    for (let i = 0; i < nx; i++) {
      const x = x0 + (i + 0.5) * dx;
      let h = terrainHeight(x, z);
      // The mill is a solid block as far as water is concerned.
      if (x > MILL.x0 && x < MILL.x1 && z > MILL.z0 && z < MILL.z1) h = Math.max(h, MILL.base + 3);
      bed[j * nx + i] = h;
    }
  }
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
