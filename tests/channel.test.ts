import { describe, expect, it } from 'vitest';
import {
  applyChannel,
  centerline,
  type ChannelPlan,
  DEFAULT_PLAN,
  manningCapacity,
  nearest,
  planChannel,
  shapeGround,
} from '../src/tools/channel';
import { ShallowWater } from '../src/water/shallowWater';
import { Material, TerrainField } from '../src/world/terrainField';

function flatField(nx: number, nz: number, dx: number, height: (x: number, z: number) => number) {
  const f = new TerrainField({ nx, nz, dx, x0: 0, z0: 0 });
  f.generate(height, () => Material.Soil);
  return f;
}

describe('channel geometry', () => {
  it('centerline passes through every control point and measures length correctly', () => {
    const pts = [{ x: 0, z: 0 }, { x: 20, z: 5 }, { x: 40, z: 0 }, { x: 60, z: 10 }];
    const line = centerline(pts, 0.25);
    for (const p of pts) expect(nearest(line, p.x, p.z).d).toBeLessThan(1e-6);
    const straight = centerline([{ x: 0, z: 0 }, { x: 30, z: 40 }]);
    expect(straight.length).toBeCloseTo(50, 6);
  });

  it('section: flat bed, side slopes, bank crest, and untouched ground beyond', () => {
    const plan: ChannelPlan = { ...DEFAULT_PLAN, points: [], startBed: 0 };
    const bankTop = plan.depth + plan.freeboard;
    // High ground (5 m): pure cut with side slopes rising into it.
    expect(shapeGround(plan, 0, 0, 5)).toBe(0);
    expect(shapeGround(plan, 0, 1.5 + 1.5 * 2, 5)).toBeCloseTo(2, 9); // 3 m out the slope at 1:1.5 -> 2 m up
    expect(shapeGround(plan, 0, 25, 5)).toBe(5); // beyond the cut slope: untouched
    // Low ground (0.2 m): bed stays where the ground already is lower, banks are built.
    expect(shapeGround(plan, 0, 0, -0.5)).toBe(-0.5); // never fills the channel bottom
    const crestMid = 1.5 + bankTop * 1.5 + plan.crestWidth / 2;
    expect(shapeGround(plan, 0, crestMid, 0.2)).toBeCloseTo(bankTop, 9);
    expect(shapeGround(plan, 0, 40, 0.2)).toBe(0.2); // outer slope has run back down to ground
  });

  it('cut volume of a straight channel in flat ground matches the trapezoid area x length', () => {
    const f = flatField(200, 80, 0.5, () => 3);
    const plan: ChannelPlan = { ...DEFAULT_PLAN, bedSlope: 0, startBed: 1, points: [{ x: 20, z: 20 }, { x: 80, z: 20 }] };
    const r = planChannel(f, plan);
    const depthCut = 2; // ground 3, bed 1
    const area = depthCut * (plan.bottomWidth + plan.sideSlope * depthCut);
    // Ends are rounded (the template sweeps around the endpoints), so allow a few percent.
    const expected = area * 60;
    console.log(`straight cut: ${r.cut.toFixed(1)} m3 vs prism ${expected.toFixed(1)} m3 (+ rounded ends)`);
    expect(r.cut).toBeGreaterThan(expected);
    expect(r.cut).toBeLessThan(expected * 1.12);
    expect(r.fill).toBe(0);
  });

  it('bed falls by slope x length, and planning does not touch the field until applied', () => {
    const f = flatField(260, 60, 0.5, () => 3);
    const plan: ChannelPlan = { ...DEFAULT_PLAN, bedSlope: 0.002, startBed: 1.5, points: [{ x: 10, z: 15 }, { x: 110, z: 15 }] };
    const before = f.heights.slice();
    const r = planChannel(f, plan);
    expect(f.heights).toEqual(before);
    expect(r.fall).toBeCloseTo(0.2, 6);
    applyChannel(f, r);
    expect(f.heightAt(10, 15)).toBeCloseTo(1.5, 2);
    expect(f.heightAt(60, 15)).toBeCloseTo(1.4, 2);
    expect(f.heightAt(110, 15)).toBeCloseTo(1.3, 2);
  });

  it('builds banks across low ground and reports the fill', () => {
    // Ground dips to 0.5 m in the middle of the run; the channel bed is at 1 m.
    const f = flatField(200, 80, 0.5, (x) => (x > 40 && x < 60 ? 0.5 : 3));
    const plan: ChannelPlan = { ...DEFAULT_PLAN, bedSlope: 0, startBed: 1, points: [{ x: 10, z: 20 }, { x: 90, z: 20 }] };
    const r = planChannel(f, plan);
    applyChannel(f, r);
    expect(r.fill).toBeGreaterThan(0);
    const bankTop = 1 + plan.depth + plan.freeboard;
    const crest = 20 + plan.bottomWidth / 2 + (plan.depth + plan.freeboard) * plan.sideSlope + plan.crestWidth / 2;
    expect(f.heightAt(50, crest)).toBeCloseTo(bankTop, 2);
    expect(f.heightAt(50, 40 - crest)).toBeCloseTo(bankTop, 2);
  });

  it('Manning capacity matches a hand calculation', () => {
    // b = 3, m = 1.5, y = 1, S = 0.001, n = 0.035: A = 4.5, P = 3 + 2*sqrt(3.25) = 6.6056
    const A = 4.5;
    const P = 3 + 2 * Math.sqrt(3.25);
    const expected = (A * Math.pow(A / P, 2 / 3) * Math.sqrt(0.001)) / 0.035;
    expect(manningCapacity(3, 1.5, 1, 0.001)).toBeCloseTo(expected, 9);
    expect(expected).toBeCloseTo(3.15, 1);
  });
});

describe('a dug channel carries water as designed', () => {
  it('reaches the design depth when fed its Manning capacity', () => {
    const dx = 0.5;
    const length = 120;
    const f = flatField(Math.round(length / dx), 60, dx, () => 4);
    const plan: ChannelPlan = {
      ...DEFAULT_PLAN,
      bedSlope: 0.002,
      startBed: 2,
      points: [{ x: -5, z: 15 }, { x: length + 5, z: 15 }],
    };
    applyChannel(f, planChannel(f, plan));
    const Q = manningCapacity(plan.bottomWidth, plan.sideSlope, plan.depth, plan.bedSlope);

    const bed = Float64Array.from(f.heights);
    const sim = new ShallowWater(f.spec, bed);
    // Feed the channel rows at the upstream edge, let it run out downstream.
    const rows: number[] = [];
    for (let j = 0; j < f.nz; j++) if (Math.abs(f.sampleZ(j) - 15) < plan.bottomWidth / 2 + plan.depth * plan.sideSlope) rows.push(j);
    sim.inflow = { rows, discharge: Q };
    sim.outflow = { slope: plan.bedSlope };
    sim.advance(1800);

    const i = Math.round(60 / dx);
    const j = Math.floor(15 / dx);
    // Steady, not just right on average: the plain scheme oscillated here by +-1 m.
    let lo = Infinity;
    let hi = -Infinity;
    for (let k = 0; k < 60; k++) {
      sim.advance(10);
      lo = Math.min(lo, sim.depth[j * f.nx + i]);
      hi = Math.max(hi, sim.depth[j * f.nx + i]);
    }
    expect(hi - lo).toBeLessThan(0.02);
    const depth = sim.depth[j * f.nx + i];
    console.log(`channel: design depth ${plan.depth} m at ${Q.toFixed(2)} m3/s, simulated ${depth.toFixed(3)} m mid-channel; outflow ${sim.lastOutflow.toFixed(2)}`);
    expect(Math.abs(sim.lastOutflow - Q) / Q).toBeLessThan(0.02);
    // The sim's grid staircases the side slopes and its friction acts per cell, so allow 10 %.
    expect(Math.abs(depth - plan.depth) / plan.depth).toBeLessThan(0.1);
  });
});
