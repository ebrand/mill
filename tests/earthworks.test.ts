import { describe, expect, it } from 'vitest';
import { riverCenter } from '../src/scene/site';
import { buildRiverSim, structureOffset } from '../src/water/riverSim';
import { createSiteField } from '../src/world/siteField';
import { type Rect, unionRect } from '../src/world/terrainField';

describe('earthworks reach the water', () => {
  it('a trench dug from the pond into dry ground fills, and water is conserved', () => {
    const field = createSiteField(1);
    const sim = buildRiverSim({ dx: 1, prefill: true, terrain: { spec: field.spec, heights: field.heights } });
    sim.advance(600); // settle

    // From inside the pond out across its bank, perpendicular to the river.
    const x = -30;
    const c = riverCenter(x);
    const at = (z: number) => {
      const i = Math.floor((x - sim.x0) / sim.dx);
      const j = Math.floor((z - sim.z0) / sim.dx);
      return j * sim.nx + i;
    };
    const pondEdge = c + 14;
    const end = c + 34;
    expect(sim.depth[at(end)]).toBe(0); // dry before digging
    const level = sim.bed[at(c)] + sim.depth[at(c)];
    expect(field.heightAt(x, end)).toBeGreaterThan(level); // above the pond before digging

    // Dig until the trench floor is a metre below pond level all the way along.
    let dirty: Rect | null = null;
    for (let pass = 0; pass < 400; pass++) {
      let deepEnough = true;
      for (let z = pondEdge; z <= end; z += 1) {
        if (field.heightAt(x, z) > level - 1) {
          deepEnough = false;
          dirty = unionRect(dirty, field.brush(x, z, 1.6, -0.05).dirty);
        }
      }
      if (deepEnough) break;
    }
    expect(dirty).not.toBeNull();

    // Apply the edit the way the worker does: bed = terrain + structures, depth kept.
    const offset = structureOffset(field.spec);
    const before = sim.totalVolume();
    for (let j = dirty!.j0; j < dirty!.j1; j++) {
      for (let i = dirty!.i0; i < dirty!.i1; i++) {
        const k = j * sim.nx + i;
        sim.bed[k] = field.heights[k] + offset[k];
      }
    }
    expect(sim.totalVolume()).toBeCloseTo(before, 6);

    const in0 = sim.volumeIn;
    const out0 = sim.volumeOut;
    sim.advance(900);
    const filled = sim.depth[at(end)];
    console.log(`trench end: depth ${filled.toFixed(3)} m after 15 min (pond level ${level.toFixed(2)} m)`);
    expect(filled).toBeGreaterThan(0.6);
    const stored = sim.totalVolume() - before;
    expect(Math.abs(stored - ((sim.volumeIn - in0) - (sim.volumeOut - out0)))).toBeLessThan(1e-6 * before);
  });
});
