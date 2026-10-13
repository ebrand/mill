import { describe, expect, it } from 'vitest';
import { MILL_LINK_ID, millLink } from '../src/mill/siteMill';
import { BREASTSHOT, runMill, SASH_SAW, WATTS_PER_HP, wheelPower } from '../src/mill/wheel';
import { buildRiverSim } from '../src/water/riverSim';

function siteWithMill(discharge: number, gate: number) {
  const sim = buildRiverSim({ dx: 1, prefill: true, discharge });
  const grid = { nx: sim.nx, nz: sim.nz, dx: sim.dx, x0: sim.x0, z0: sim.z0 };
  sim.setLink(millLink(grid, gate));
  return { sim, grid };
}

describe('the site mill', () => {
  it('draws water from the pond through the wheel with a breastshot head and real power', () => {
    const { sim } = siteWithMill(12, 0.3);
    sim.advance(900);
    const st = sim.linkState.get(MILL_LINK_ID)!;
    const head = st.etaFrom - st.etaTo - 0.1;
    const run = runMill(wheelPower(BREASTSHOT, st.discharge, head), SASH_SAW);
    console.log(`gate 0.3 m: ${st.discharge.toFixed(2)} m3/s, head ${head.toFixed(2)} m, wheel ${run.wheelHp.toFixed(1)} hp, saw ${(run.speed * 100).toFixed(0)}%`);
    expect(st.discharge).toBeGreaterThan(0.5);
    expect(head).toBeGreaterThan(BREASTSHOT.designHead[0]);
    expect(head).toBeLessThan(BREASTSHOT.designHead[1]);
    expect(run.speed).toBe(1);
    expect(run.wheelHp).toBeGreaterThan(SASH_SAW.ratedHp);
    expect(run.wheelHp).toBeLessThan(80);
    // Water through the wheel doesn't vanish: still ~12 m3/s leaving the map in total.
    expect(Math.abs(sim.lastOutflow - 12) / 12).toBeLessThan(0.05);
  });

  it('in low water a wide-open gate draws the pond down; shutting it lets the pond refill', () => {
    const { sim, grid } = siteWithMill(1.0, 0.6); // a dry summer: 1 m3/s in, gate wide open
    const pond = () => {
      const i = Math.floor((-4 - sim.x0) / sim.dx);
      const j = Math.floor((-0.6 - sim.z0) / sim.dx);
      return sim.bed[j * sim.nx + i] + sim.depth[j * sim.nx + i];
    };
    const start = pond();
    sim.advance(3600);
    const drawn = pond();
    const q = sim.linkState.get(MILL_LINK_ID)!.discharge;
    console.log(`dry summer: pond ${start.toFixed(2)} -> ${drawn.toFixed(2)} m in an hour; wheel now takes ${q.toFixed(2)} m3/s`);
    expect(drawn).toBeLessThan(start - 0.1);
    sim.setLink(millLink(grid, 0));
    sim.advance(3600);
    const refilled = pond();
    console.log(`gate shut an hour: pond back to ${refilled.toFixed(2)} m`);
    expect(refilled).toBeGreaterThan(drawn + 0.05);
    expect(sim.linkState.get(MILL_LINK_ID)!.discharge).toBe(0);
  });

  it('power and water per the units shown to the player', () => {
    // 1 m3/s over 3 m at 0.6 efficiency is ~23.7 hp.
    expect(wheelPower(BREASTSHOT, 1, 3) / WATTS_PER_HP).toBeCloseTo(23.68, 1);
  });
});
