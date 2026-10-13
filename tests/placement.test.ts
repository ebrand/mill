import { describe, expect, it } from 'vitest';
import { PlacementController } from '../src/mill/placement';
import { Material, TerrainField } from '../src/world/terrainField';

function field() {
  // Shallow pond edge at x < 10 (ground 1.7), race floor beyond (ground 0.5), river low at x > 30.
  const f = new TerrainField({ nx: 100, nz: 40, dx: 0.5, x0: 0, z0: 0 });
  f.generate((x) => (x < 10 ? 1.7 : x < 30 ? 0.5 : -1.4), () => Material.Soil);
  return f;
}

function preview(kind: 'gate' | 'wheel', a: [number, number], b: [number, number]) {
  const c = new PlacementController(kind);
  c.env = { field: field(), water: () => null, onBuild: () => {} };
  c.addPoint(...a);
  c.addPoint(...b);
  c.update(1e9);
  return c;
}

describe('placement sill', () => {
  it('a head gate sits on the floor of the race it feeds, not the shallow pond edge', () => {
    expect(preview('gate', [8, 10], [12, 10]).getSnapshot().sill).toBeCloseTo(0.5, 9);
  });
  it('a wheel sits on the floor of the race end it draws from, not the low tailrace', () => {
    expect(preview('wheel', [28, 10], [32, 10]).getSnapshot().sill).toBeCloseTo(0.5, 9);
  });
  it('a set sill overrides the automatic one; a third click moves the outlet', () => {
    const c = preview('gate', [8, 10], [12, 10]);
    c.setParam('sill', 0.8);
    c.addPoint(14, 10);
    c.update(2e9);
    expect(c.points).toHaveLength(2);
    expect(c.points[1].x).toBe(14);
    expect(c.getSnapshot().sill).toBe(0.8);
  });
});

describe('spillway placement', () => {
  it('suggests a crest once and keeps it while the water moves; Clear starts afresh', () => {
    const f = new TerrainField({ nx: 100, nz: 60, dx: 0.5, x0: 0, z0: 0 });
    f.generate(() => 0, () => Material.Soil);
    let level = 1.0;
    const water = { surfaceAt: () => ({ eta: level, depth: level }), discharge: 6 } as unknown as import('../src/water/WaterClient').WaterClient;
    const c = new PlacementController('spillway');
    c.env = { field: f, water: () => water, onBuild: () => {} };
    c.addPoint(20, 2);
    c.addPoint(20, 28);
    c.update(1e9);
    expect(c.getSnapshot().sill).toBeCloseTo(2.0, 9);
    level = 1.6; // the water rises (e.g. banks going up)
    c.update(2e9);
    expect(c.getSnapshot().sill).toBeCloseTo(2.0, 9);
    c.clear();
    c.addPoint(20, 2);
    c.addPoint(20, 28);
    c.update(3e9);
    expect(c.getSnapshot().sill).toBeCloseTo(2.6, 9);
  });
});
