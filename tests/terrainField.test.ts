import { describe, expect, it } from 'vitest';
import { MeshBasicMaterial } from 'three';
import { terrainHeight } from '../src/scene/site';
import { buildRiverSim } from '../src/water/riverSim';
import { createSiteField } from '../src/world/siteField';
import { Material, TerrainField } from '../src/world/terrainField';
import { TerrainMeshes } from '../src/world/terrainMesh';

describe('TerrainField', () => {
  const field = createSiteField(0.5);

  it('samples the site terrain at the water sim cell centers', () => {
    const sim = buildRiverSim({ dx: 0.5, prefill: false });
    expect(field.nx).toBe(sim.nx);
    expect(field.nz).toBe(sim.nz);
    for (const [i, j] of [[0, 0], [100, 200], [519, 319], [260, 150]]) {
      expect(field.sampleX(i)).toBeCloseTo(sim.cellX(i), 9);
      expect(field.sampleZ(j)).toBeCloseTo(sim.cellZ(j), 9);
      expect(field.heights[j * field.nx + i]).toBeCloseTo(terrainHeight(field.sampleX(i), field.sampleZ(j)), 4);
    }
  });

  it('heightAt interpolates between samples and matches them exactly at sample points', () => {
    expect(field.heightAt(field.sampleX(40), field.sampleZ(60))).toBeCloseTo(field.heights[60 * field.nx + 40], 5);
    const x = (field.sampleX(40) + field.sampleX(41)) / 2;
    const mid = (field.heights[60 * field.nx + 40] + field.heights[60 * field.nx + 41]) / 2;
    expect(field.heightAt(x, field.sampleZ(60))).toBeCloseTo(mid, 5);
  });

  it('raycast finds the ground under a downward ray and from a slanted camera ray', () => {
    const down = field.raycast([10, 100, 30], [0, -1, 0]);
    expect(down).not.toBeNull();
    expect(down![1]).toBeCloseTo(field.heightAt(10, 30), 3);
    const slant = field.raycast([-48, 34, -52], [64, -31, 66]);
    expect(slant).not.toBeNull();
    expect(slant![1]).toBeCloseTo(field.heightAt(slant![0], slant![2]), 3);
    expect(field.raycast([0, 100, 0], [0, 1, 0])).toBeNull();
  });

  it('brush volumes match the actual change in ground volume', () => {
    const f = new TerrainField({ nx: 80, nz: 80, dx: 0.5, x0: 0, z0: 0 });
    const before = f.heights.reduce((a, b) => a + b, 0);
    const dig = f.brush(20, 20, 3, -0.4);
    const afterDig = f.heights.reduce((a, b) => a + b, 0);
    expect(dig.cut).toBeGreaterThan(0);
    expect(dig.fill).toBe(0);
    expect((before - afterDig) * 0.25).toBeCloseTo(dig.cut, 4);
    const fill = f.brush(20, 20, 3, 0.4);
    expect(fill.fill).toBeCloseTo(dig.cut, 4);
    expect(dig.dirty).not.toBeNull();
    // The dirty rect covers every changed sample and stays near the brush.
    expect(dig.dirty!.i0).toBeGreaterThanOrEqual(Math.floor((20 - 3) / 0.5) - 1);
    expect(dig.dirty!.i1).toBeLessThanOrEqual(Math.ceil((20 + 3) / 0.5) + 1);
  });

  it('ledge rock digs ten times slower than soil', () => {
    const f = new TerrainField({ nx: 40, nz: 40, dx: 0.5, x0: 0, z0: 0 });
    f.material.fill(Material.Rock, 0, 40 * 20);
    const soil = f.brush(10, 15, 2, -0.5).cut;
    const rock = f.brush(10, 5, 2, -0.5).cut;
    expect(rock / soil).toBeCloseTo(0.1, 5);
  });
});

describe('TerrainMeshes', () => {
  it('chunks agree on shared edges, including after an edit across a chunk border', () => {
    const f = new TerrainField({ nx: 150, nz: 140, dx: 0.5, x0: 0, z0: 0 });
    f.generate((x, z) => Math.sin(x * 0.3) + Math.cos(z * 0.2), () => Material.Soil);
    const meshes = new TerrainMeshes(f, new MeshBasicMaterial(), 64);
    expect(meshes.chunkCount).toBe(9);
    // A brush centered on the corner where four chunks meet.
    const edit = f.brush(f.sampleX(64), f.sampleZ(64), 4, -1);
    expect(meshes.update(edit.dirty!)).toBe(4);
    for (const [i, j] of [[64, 64], [64, 60], [60, 64], [64, 0], [128, 64]]) {
      const hs = meshes.heightsAt(i, j);
      expect(hs.length).toBeGreaterThan(0);
      for (const h of hs) expect(h).toBeCloseTo(f.heights[j * f.nx + i], 6);
    }
  });
});
