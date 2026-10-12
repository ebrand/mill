import { describe, expect, it } from 'vitest';
import { writeHeights } from '../src/tools/channel';
import { DEFAULT_EMBANKMENT, type EmbankmentPlan, planEmbankment, shapeBank } from '../src/tools/embankment';
import { ShallowWater } from '../src/water/shallowWater';
import { Material, TerrainField } from '../src/world/terrainField';

function field(nx: number, nz: number, dx: number, h: (x: number, z: number) => number) {
  const f = new TerrainField({ nx, nz, dx, x0: 0, z0: 0 });
  f.generate(h, () => Material.Soil);
  return f;
}

describe('embankment geometry', () => {
  it('level crest, side slopes down to the ground, never lowers anything', () => {
    const plan: EmbankmentPlan = { ...DEFAULT_EMBANKMENT, crest: 3, points: [] };
    expect(shapeBank(plan, 0, 0)).toBe(3);
    expect(shapeBank(plan, plan.crestWidth / 2, 0)).toBe(3);
    expect(shapeBank(plan, plan.crestWidth / 2 + 2, 0)).toBeCloseTo(2, 9); // 2:1 slope -> 1 m down per 2 m
    expect(shapeBank(plan, 50, 0)).toBe(0);
    expect(shapeBank(plan, 0, 5)).toBe(5); // higher ground is left alone
  });

  it('fill of a straight bank on flat ground matches the trapezoid area x length', () => {
    const f = field(200, 80, 0.5, () => 0);
    const plan: EmbankmentPlan = { ...DEFAULT_EMBANKMENT, crest: 2, points: [{ x: 20, z: 20 }, { x: 80, z: 20 }] };
    const r = planEmbankment(f, plan);
    const area = 2 * (plan.crestWidth + plan.sideSlope * 2);
    console.log(`bank fill ${r.fill.toFixed(1)} m3 vs prism ${(area * 60).toFixed(1)} m3 (+ rounded ends)`);
    expect(r.fill).toBeGreaterThan(area * 60);
    expect(r.fill).toBeLessThan(area * 60 * 1.12);
    expect(r.maxHeight).toBeCloseTo(2, 6);
  });
});

describe('a built bank holds water', () => {
  it('dams a channel: water ponds behind it up to the crest, then spills over', () => {
    const dx = 0.5;
    const nx = 240;
    const nz = 40;
    // A gently sloping valley 20 m wide, walls high on both sides.
    const f = field(nx, nz, dx, (x, z) => -0.002 * x + (Math.abs(z - 10) > 6 ? 6 : 0));
    const crest = 1.5;
    const plan: EmbankmentPlan = { ...DEFAULT_EMBANKMENT, crest, points: [{ x: 70, z: 0 }, { x: 70, z: 20 }] };
    const r = planEmbankment(f, plan);
    writeHeights(f, r.rect, r.heights);

    const sim = new ShallowWater(f.spec, Float64Array.from(f.heights));
    const rows: number[] = [];
    for (let j = 0; j < nz; j++) if (Math.abs(f.sampleZ(j) - 10) < 6) rows.push(j);
    sim.inflow = { rows, discharge: 2 };
    sim.outflow = { slope: 0.002 };
    sim.advance(3 * 3600);

    const upstream = sim.bed[20 * nx + Math.round(40 / dx)] + sim.depth[20 * nx + Math.round(40 / dx)];
    const downstreamDepth = sim.depth[20 * nx + Math.round(100 / dx)];
    console.log(`pond behind bank ${upstream.toFixed(3)} m (crest ${crest}); downstream depth ${downstreamDepth.toFixed(3)} m; outflow ${sim.lastOutflow.toFixed(2)}`);
    expect(upstream).toBeGreaterThan(crest);
    expect(upstream).toBeLessThan(crest + 0.3);
    expect(downstreamDepth).toBeGreaterThan(0.02);
    expect(Math.abs(sim.lastOutflow - 2) / 2).toBeLessThan(0.03);
  });
});
