import { describe, expect, it } from 'vitest';
import { StructuresController } from '../src/mill/structuresController';
import { RIVER_DISCHARGE, riverBed, riverCenter, terrainHeight, WHEEL } from '../src/scene/site';
import { buildRiverSim } from '../src/water/riverSim';
import { createSiteField } from '../src/world/siteField';

describe('the untouched valley start', () => {
  it('has no wheel pit or tailrace carved into it', () => {
    expect(terrainHeight(WHEEL.x, WHEEL.z, true)).toBeLessThan(-2);
    expect(terrainHeight(WHEEL.x, WHEEL.z, false)).toBeGreaterThan(-1);
    const f = createSiteField(1, 'valley');
    expect(f.heightAt(WHEEL.x, WHEEL.z)).toBeCloseTo(terrainHeight(WHEEL.x, WHEEL.z, false), 1);
  });

  it('is just the river: no dam holding a pond, flowing through at its natural depth', () => {
    const sim = buildRiverSim({ dx: 1, start: 'valley' });
    sim.advance(1800);
    expect(sim.lastWeirFlow).toBe(0);
    expect(sim.links.size).toBe(0);
    expect(Math.abs(sim.lastOutflow - RIVER_DISCHARGE) / RIVER_DISCHARGE).toBeLessThan(0.03);
    // Where the old dam stood, the river is about its normal depth, not a pond.
    const at = (x: number) => {
      const i = Math.floor((x - sim.x0) / sim.dx);
      const j = Math.floor((riverCenter(x) - sim.z0) / sim.dx);
      return sim.bed[j * sim.nx + i] + sim.depth[j * sim.nx + i];
    };
    for (const x of [-60, -4, 30]) {
      const depth = at(x) - riverBed(x);
      expect(depth).toBeGreaterThan(0.3);
      expect(depth).toBeLessThan(1.2);
    }
    // And it falls downstream, as a river should.
    expect(at(-60)).toBeGreaterThan(at(30));
  });

  it('starts with no structures; the demo starts with the old mill', () => {
    expect(new StructuresController(false).structures).toHaveLength(0);
    expect(new StructuresController(true).structures).toHaveLength(1);
  });
});
