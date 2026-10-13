import { describe, expect, it } from 'vitest';
import { headOverCrest, SPILLWAY_C, spillwayWeirs } from '../src/mill/spillway';
import { ShallowWater } from '../src/water/shallowWater';

/** A flat-bottomed basin 60 x 40 m with walls, fed from the west, draining east. */
function basin(dx = 0.5) {
  const nx = Math.round(60 / dx);
  const nz = Math.round(40 / dx);
  const bed = new Float64Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) bed[j * nx + i] = -0.002 * (i + 0.5) * dx;
  const sim = new ShallowWater({ nx, nz, dx, x0: 0, z0: 0 }, bed);
  const grid = { nx, nz, dx, x0: 0, z0: 0 };
  return { sim, grid, nx, nz };
}

function pondLevel(sim: ShallowWater, x: number, z: number) {
  const i = Math.floor(x / sim.dx);
  const j = Math.floor(z / sim.dx);
  return sim.bed[j * sim.nx + i] + sim.depth[j * sim.nx + i];
}

describe('spillway', () => {
  it('a diagonal crest is watertight below its crest', () => {
    const { sim, grid, nx, nz } = basin();
    // Crest from wall to wall on a diagonal.
    sim.setWeirGroup('s', spillwayWeirs(grid, { x: 20, z: -1 }, { x: 40, z: 41 }, 1.0));
    // Fill the west side to below the crest; the east side stays dry.
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const x = (i + 0.5) * 0.5;
      const z = (j + 0.5) * 0.5;
      const side = (40 - 20) * (z + 1) - (41 + 1) * (x - 20); // >0 on the west of the line
      if (side > 0) sim.depth[j * nx + i] = Math.max(0, 0.8 - sim.bed[j * nx + i]);
    }
    const v0 = sim.totalVolume();
    sim.advance(600);
    let east = 0;
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const x = (i + 0.5) * 0.5;
      const z = (j + 0.5) * 0.5;
      if ((40 - 20) * (z + 1) - (41 + 1) * (x - 20) < -2) east += sim.depth[j * nx + i];
    }
    expect(east).toBeLessThan(1e-6);
    expect(sim.totalVolume()).toBeCloseTo(v0, 6);
  });

  for (const [name, a, b] of [
    ['straight', { x: 30, z: -1 }, { x: 30, z: 41 }],
    ['diagonal', { x: 20, z: -1 }, { x: 40, z: 41 }],
  ] as const) {
    it(`a ${name} crest holds the pond at the weir-law head over it`, () => {
      const { sim, grid, nz } = basin();
      const crest = 1.0;
      sim.setWeirGroup('s', spillwayWeirs(grid, a, b, crest));
      const Q = 6;
      sim.inflow = { rows: Array.from({ length: nz }, (_, j) => j), discharge: Q };
      sim.outflow = { slope: 0.002 };
      sim.advance(3 * 3600);
      // Crest length is the basin's width crossed (40 m wide), whatever the angle.
      const lengthInBasin = name === 'straight' ? 40 : Math.hypot(20 * (40 / 42), 40);
      const expected = crest + headOverCrest(Q, lengthInBasin);
      const level = pondLevel(sim, 5, 20);
      const flow = sim.weirGroupFlow.get('s')!;
      console.log(`${name}: pond ${level.toFixed(3)} m, weir law ${expected.toFixed(3)} m, flow over ${flow.toFixed(2)} m3/s`);
      expect(Math.abs(level - expected)).toBeLessThan(0.03);
      expect(Math.abs(flow - Q) / Q).toBeLessThan(0.02);
    });
  }

  it('head over a crest follows Q = C L H^1.5', () => {
    const h = headOverCrest(10, 12);
    expect(SPILLWAY_C * 12 * Math.pow(h, 1.5)).toBeCloseTo(10, 9);
  });
});
