import { describe, expect, it } from 'vitest';
import { BREAST, newStructureId, type Structure, structureLink, wheelGeometry, wheelHead } from '../src/mill/structures';
import { planPit } from '../src/tools/pit';
import { BREASTSHOT, runMill, SASH_SAW, wheelPower } from '../src/mill/wheel';
import { riverCenter } from '../src/scene/site';
import { applyChannel, type ChannelPlan, DEFAULT_PLAN, planChannel } from '../src/tools/channel';
import { buildRiverSim, structureOffset } from '../src/water/riverSim';
import { createSiteField } from '../src/world/siteField';

describe('a mill built from scratch on the south bank', () => {
  it('gate through the dam, a headrace along the bank, a wheel into the river: real power', () => {
    const field = createSiteField(1);
    const c = (x: number) => riverCenter(x);
    const sim = buildRiverSim({ dx: 1, prefill: true, terrain: { spec: field.spec, heights: field.heights } });
    sim.advance(600);
    const grid = { nx: sim.nx, nz: sim.nz, dx: sim.dx, x0: sim.x0, z0: sim.z0 };
    const pondLevel = sim.bed[Math.floor((c(-4) - sim.z0) / sim.dx) * sim.nx + Math.floor((-4 - sim.x0) / sim.dx)] + 0;

    // Headrace: from just below the dam along the south bank, 1 in 1000, 3 m wide.
    const start = { x: 3, z: c(3) - 13 };
    const end = { x: 40, z: c(40) - 13 };
    const plan: ChannelPlan = {
      ...DEFAULT_PLAN,
      points: [start, { x: 20, z: c(20) - 14 }, end],
      startBed: 1.0, // a metre below the usual pond level
    };
    const race = planChannel(field, plan);
    applyChannel(field, race);
    const offset = structureOffset(field.spec);
    for (let k = 0; k < sim.bed.length; k++) sim.bed[k] = field.heights[k] + offset[k];

    const gate: Structure = {
      id: newStructureId('gate'), kind: 'gate', name: 'Gate', width: 2, opening: 0.6, maxOpening: 1, lumber: 0,
      intake: { x: -3, z: c(-3) - 13 }, outlet: start, sill: 1.0,
    };
    const wheel: Structure = {
      id: newStructureId('wheel'), kind: 'wheel', name: 'Wheel', width: 2.2, opening: 0.4, maxOpening: 0.6, lumber: 0,
      intake: { x: end.x - 1, z: end.z }, outlet: { x: end.x + 4, z: c(end.x + 4) - 4 }, sill: 0.95,
    };
    // Dig the wheel pit as the Wheel tool does, leaving a breast of earth after the race.
    const geo = wheelGeometry(wheel.sill, field.heightAt(wheel.outlet.x, wheel.outlet.z));
    const pit = planPit(field, wheel.intake, wheel.outlet, BREAST, wheel.width + 1.2, geo.floor);
    const pw = pit.rect.i1 - pit.rect.i0;
    for (let j = pit.rect.j0; j < pit.rect.j1; j++)
      for (let i = pit.rect.i0; i < pit.rect.i1; i++) {
        const k = j * field.nx + i;
        field.heights[k] = pit.heights[(j - pit.rect.j0) * pw + (i - pit.rect.i0)];
        sim.bed[k] = field.heights[k] + offset[k];
      }
    expect(pit.cut).toBeGreaterThan(5);

    sim.setLink(structureLink(grid, gate));
    sim.setLink(structureLink(grid, wheel));

    const v0 = sim.totalVolume();
    const in0 = sim.volumeIn;
    const out0 = sim.volumeOut;
    sim.advance(3600);

    const g = sim.linkState.get(gate.id)!;
    const w = sim.linkState.get(wheel.id)!;
    const head = wheelHead(w.etaFrom, w.etaTo);
    const run = runMill(wheelPower(BREASTSHOT, w.discharge, head), SASH_SAW);
    console.log(
      `gate ${g.discharge.toFixed(2)} m3/s (pond ${g.etaFrom.toFixed(2)} -> race ${g.etaTo.toFixed(2)}); ` +
        `wheel ${w.discharge.toFixed(2)} m3/s, race ${w.etaFrom.toFixed(2)} -> river ${w.etaTo.toFixed(2)}, head ${head.toFixed(2)} m, ${run.wheelHp.toFixed(1)} hp, saw ${(run.speed * 100).toFixed(0)}%; ` +
        `race cut ${race.cut.toFixed(0)} m3 fill ${race.fill.toFixed(0)} m3; pit cut ${pit.cut.toFixed(0)} m3`,
    );
    expect(g.discharge).toBeGreaterThan(0.3);
    expect(w.discharge).toBeGreaterThan(0.3);
    expect(head).toBeGreaterThan(BREASTSHOT.designHead[0]);
    expect(head).toBeLessThan(BREASTSHOT.designHead[1]);
    expect(run.speed).toBe(1);
    // Steady: what the gate lets in, the wheel passes on (within a few percent).
    expect(Math.abs(g.discharge - w.discharge) / g.discharge).toBeLessThan(0.1);
    // Water is conserved through two structures and the race.
    const stored = sim.totalVolume() - v0;
    expect(Math.abs(stored - ((sim.volumeIn - in0) - (sim.volumeOut - out0)))).toBeLessThan(1e-6 * v0);
    expect(pondLevel).toBeDefined();
  });
});
