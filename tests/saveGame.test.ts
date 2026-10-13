import { describe, expect, it } from 'vitest';
import { incompatibility, SAVE_VERSION, type SaveData } from '../src/save/saveGame';
import { Material, TerrainField } from '../src/world/terrainField';

function setup() {
  const f = new TerrainField({ nx: 20, nz: 10, dx: 0.5, x0: -5, z0: -2.5 });
  f.generate(() => 1, () => Material.Soil);
  const save: SaveData = {
    version: SAVE_VERSION,
    savedAt: 0,
    spec: f.spec,
    heights: f.heights.slice(),
    material: f.material.slice(),
    depth: new Float32Array(200),
    simTime: 12,
    discharge: 12,
    cut: 1,
    fill: 2,
  };
  return { f, save };
}

describe('save validation', () => {
  it('accepts a save made from the same map', () => {
    const { f, save } = setup();
    expect(incompatibility(save, f)).toBeNull();
    expect(incompatibility({ ...save, depth: null }, f)).toBeNull();
  });

  it('rejects other versions, other map sizes, wrong lengths and bad numbers', () => {
    const { f, save } = setup();
    expect(incompatibility({ ...save, version: SAVE_VERSION + 1 }, f)).toMatch(/version/);
    expect(incompatibility({ ...save, spec: { ...save.spec, nx: 21 } }, f)).toMatch(/map size/);
    expect(incompatibility({ ...save, spec: { ...save.spec, dx: 1 } }, f)).toMatch(/map size/);
    expect(incompatibility({ ...save, heights: new Float32Array(199) }, f)).toMatch(/length/);
    expect(incompatibility({ ...save, depth: new Float32Array(3) }, f)).toMatch(/water/);
    const bad = save.heights.slice();
    bad[7] = NaN;
    expect(incompatibility({ ...save, heights: bad }, f)).toMatch(/invalid/);
  });
});
