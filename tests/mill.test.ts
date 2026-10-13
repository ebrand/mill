import { describe, expect, it } from 'vitest';
import {
  BREASTSHOT,
  DRIVE_LOSS,
  dischargeFor,
  runMill,
  SASH_SAW,
  WATTS_PER_HP,
  wheelEfficiency,
  wheelPower,
} from '../src/mill/wheel';
import { G, gateDischarge, ShallowWater } from '../src/water/shallowWater';

describe('gate discharge', () => {
  it('orifice flow once the water covers the gate lip', () => {
    // 2.4 m wide, 0.4 m open, sill at 0, water at 1.5: Q = 0.6 * 2.4 * 0.4 * sqrt(2g * 1.3)
    const expected = 0.6 * 2.4 * 0.4 * Math.sqrt(2 * G * 1.3);
    expect(gateDischarge(1.5, -Infinity, 0, 0.4, 2.4)).toBeCloseTo(expected, 9);
  });

  it('a drowned gate passes less as the water behind it rises, and nothing when level', () => {
    // Drowned orifice: head is the difference of levels.
    const drowned = gateDischarge(2.0, 1.6, 0, 0.4, 2);
    expect(drowned).toBeCloseTo(0.6 * 2 * 0.4 * Math.sqrt(2 * G * 0.4), 9);
    expect(drowned).toBeLessThan(gateDischarge(2.0, -Infinity, 0, 0.4, 2));
    let prev = Infinity;
    for (let down = -1; down < 2; down += 0.02) {
      const q = gateDischarge(2.0, down, 0, 0.4, 2);
      expect(q).toBeLessThanOrEqual(prev + 1e-12);
      prev = q;
    }
    expect(gateDischarge(2.0, 2.0, 0, 0.4, 2)).toBe(0);
  });

  it('weir flow over the sill when the water is below the lip, and continuous between', () => {
    expect(gateDischarge(0.3, -Infinity, 0, 1.0, 2)).toBeCloseTo(1.7 * 2 * Math.pow(0.3, 1.5), 9);
    expect(gateDischarge(-0.1, -Infinity, 0, 0.5, 2)).toBe(0);
    expect(gateDischarge(1, -Infinity, 0, 0, 2)).toBe(0);
    // No jump anywhere as the water rises past the lip.
    let prev = 0;
    for (let eta = 0.01; eta < 3; eta += 0.01) {
      const q = gateDischarge(eta, -Infinity, 0, 0.5, 2);
      expect(q).toBeGreaterThanOrEqual(prev);
      expect(q - prev).toBeLessThan(0.08);
      prev = q;
    }
  });
});

describe('wheel and drivetrain', () => {
  it('power is efficiency x rho g Q H', () => {
    const w = wheelPower(BREASTSHOT, 2, 3);
    expect(w).toBeCloseTo(0.6 * 1000 * G * 2 * 3, 6);
    expect(w / WATTS_PER_HP).toBeCloseTo(47.4, 1);
  });

  it('efficiency is flat in the design range and falls away outside it', () => {
    expect(wheelEfficiency(BREASTSHOT, 3)).toBe(0.6);
    expect(wheelEfficiency(BREASTSHOT, 1.5)).toBeCloseTo(0.3, 9);
    expect(wheelEfficiency(BREASTSHOT, 1.0)).toBe(0);
    expect(wheelEfficiency(BREASTSHOT, 5)).toBe(0);
  });

  it('machines run full speed with power to spare, and slow in proportion when short', () => {
    const plenty = runMill(30 * WATTS_PER_HP, SASH_SAW);
    expect(plenty.speed).toBe(1);
    expect(plenty.perHour).toBe(SASH_SAW.perHour);
    expect(plenty.spareHp).toBeCloseTo(30 * (1 - DRIVE_LOSS) - 10, 9);
    const short = runMill(5 * WATTS_PER_HP, SASH_SAW);
    expect(short.speed).toBeCloseTo((5 * (1 - DRIVE_LOSS)) / 10, 9);
    expect(short.perHour).toBeCloseTo(SASH_SAW.perHour * short.speed, 9);
  });

  it('dischargeFor gives the flow that exactly runs the machine', () => {
    const q = dischargeFor(BREASTSHOT, SASH_SAW, 3);
    expect(runMill(wheelPower(BREASTSHOT, q, 3), SASH_SAW).speed).toBeCloseTo(1, 9);
  });
});

describe('links in the water sim', () => {
  it('a gated link drains a pond into a pit at the gate rate and conserves water', () => {
    // Two basins separated by a high wall; the link is the only way across.
    const nx = 40;
    const nz = 10;
    const bed = new Float64Array(nx * nz);
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) bed[j * nx + i] = i === 20 ? 10 : i < 20 ? 0 : -3;
    const sim = new ShallowWater({ nx, nz, dx: 1, x0: 0, z0: 0 }, bed);
    for (let j = 0; j < nz; j++) for (let i = 0; i < 20; i++) sim.depth[j * nx + i] = 2;
    const from: number[] = [];
    const to: number[] = [];
    for (let j = 3; j < 7; j++) {
      from.push(j * nx + 18);
      to.push(j * nx + 25);
    }
    sim.setLink({ id: 'gate', from, to, sill: 0.5, width: 1.5, opening: 0.3, maxDischarge: 10 });
    const v0 = sim.totalVolume();
    sim.advance(2);
    const st = sim.linkState.get('gate')!;
    const expected = gateDischarge(st.etaFrom, st.etaTo, 0.5, 0.3, 1.5);
    expect(st.discharge).toBeCloseTo(expected, 2);
    sim.advance(600);
    expect(sim.totalVolume()).toBeCloseTo(v0, 6);
    let pit = 0;
    for (let j = 0; j < nz; j++) for (let i = 21; i < nx; i++) pit += sim.depth[j * nx + i];
    expect(pit).toBeGreaterThan(0);
    // Pond drawn down to near the sill and no further.
    const pond = sim.bed[5 * nx + 10] + sim.depth[5 * nx + 10];
    expect(pond).toBeGreaterThan(0.5);
    expect(pond).toBeLessThan(2);
  });

  it('nothing flows through a shut gate or uphill', () => {
    const nx = 10;
    const bed = new Float64Array(nx).fill(0);
    const sim = new ShallowWater({ nx, nz: 1, dx: 1, x0: 0, z0: 0 }, bed);
    sim.depth[1] = 1;
    sim.depth[8] = 2;
    sim.setLink({ id: 'shut', from: [1], to: [8], sill: 0, width: 1, opening: 0, maxDischarge: 10 });
    sim.advance(5);
    expect(sim.linkState.get('shut')!.discharge).toBe(0);
    sim.setLink({ id: 'shut', from: [1], to: [8], sill: 0, width: 1, opening: 1, maxDischarge: 10 });
    sim.advance(5);
    expect(sim.linkState.get('shut')!.discharge).toBe(0); // 8 is higher than 1
  });
});
