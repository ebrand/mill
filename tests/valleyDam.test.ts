import { describe, expect, it } from 'vitest';
import { headOverCrest, openCrestLength, spillwayWeirs } from '../src/mill/spillway';
import { RIVER_DISCHARGE, riverBed, riverCenter, STEADY_RIVER_STAGE } from '../src/scene/site';
import { writeHeights } from '../src/tools/channel';
import { DEFAULT_EMBANKMENT, planEmbankment } from '../src/tools/embankment';
import { buildRiverSim } from '../src/water/riverSim';
import { createSiteField } from '../src/world/siteField';

describe('a dam built in the untouched valley', () => {
  it('banks across the floodplain and a spillway across the river hold a pond at crest + head', () => {
    const field = createSiteField(1, 'valley');
    const x = 0;
    const c = riverCenter(x);
    const river = riverBed(x) + STEADY_RIVER_STAGE;
    const crest = Math.round((river + 1.5) * 10) / 10;
    const gap = 8; // spillway spans the channel, 16 m
    // Earth banks either side, tied into the valley sides, a metre over the crest.
    for (const side of [1, -1]) {
      const r = planEmbankment(field, { ...DEFAULT_EMBANKMENT, crest: crest + 1.2, points: [{ x, z: c + side * gap }, { x, z: c + side * 45 }] });
      writeHeights(field, r.rect, r.heights);
    }
    const sim = buildRiverSim({ dx: 1, start: 'valley', terrain: { spec: field.spec, heights: field.heights } });
    const grid = { nx: sim.nx, nz: sim.nz, dx: sim.dx, x0: sim.x0, z0: sim.z0 };
    const a = { x, z: c - gap - 1 };
    const b = { x, z: c + gap + 1 };
    sim.setWeirGroup('spill', spillwayWeirs(grid, a, b, crest));
    sim.advance(4 * 3600);

    const at = (px: number) => {
      const i = Math.floor((px - sim.x0) / sim.dx);
      const j = Math.floor((riverCenter(px) - sim.z0) / sim.dx);
      return sim.bed[j * sim.nx + i] + sim.depth[j * sim.nx + i];
    };
    const pond = at(-6);
    // The weir passes the whole river; the effective crest is where the channel holds water.
    const flow = sim.weirGroupFlow.get('spill')!;
    // Bank ends close part of the crest; the head follows the open length.
    const open = openCrestLength((px, pz) => field.heightAt(px, pz), a, b, crest);
    const predicted = crest + headOverCrest(RIVER_DISCHARGE, open);
    console.log(
      `crest ${crest} m: pond ${pond.toFixed(2)} m (weir law over ${open.toFixed(1)} m open of ${(2 * gap + 2).toFixed(0)} m: ${predicted.toFixed(2)} m), ` +
        `${flow.toFixed(2)} m3/s over the spillway, ${sim.lastOutflow.toFixed(2)} leaving; below the dam ${at(10).toFixed(2)} m`,
    );
    expect(pond).toBeGreaterThan(crest);
    expect(Math.abs(pond - predicted)).toBeLessThan(0.12);
    expect(Math.abs(flow - RIVER_DISCHARGE) / RIVER_DISCHARGE).toBeLessThan(0.03);
    expect(Math.abs(sim.lastOutflow - RIVER_DISCHARGE) / RIVER_DISCHARGE).toBeLessThan(0.03);
    expect(at(10)).toBeLessThan(crest);
  });
});
