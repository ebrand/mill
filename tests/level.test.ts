import { describe, expect, it } from 'vitest';
import { feetInches, gradient, LevelController } from '../src/tools/levelTool';
import { Material, TerrainField } from '../src/world/terrainField';

describe('surveyor’s level', () => {
  it('formats feet and inches and gradients the period way', () => {
    expect(feetInches(1)).toBe('3 ft 3 in');
    expect(feetInches(-0.3048)).toBe('−1 ft 0 in');
    expect(gradient(-0.1, 100)).toBe('1 in 1,000 fall');
    expect(gradient(0.5, 50)).toBe('1 in 100 rise');
    expect(gradient(0, 50)).toBe('level');
  });

  it('reads the ground difference between two staff points and keeps a field book', () => {
    const f = new TerrainField({ nx: 200, nz: 20, dx: 0.5, x0: 0, z0: 0 });
    f.generate((x) => 5 - 0.01 * x, () => Material.Soil); // falls 1 cm per metre
    const lvl = new LevelController();
    lvl.env = { field: f, water: () => null };
    lvl.addPoint(10, 5);
    lvl.addPoint(60, 5);
    lvl.update(1);
    const shot = lvl.getSnapshot().shot!;
    expect(shot.distance).toBeCloseTo(50, 9);
    expect(shot.rise).toBeCloseTo(-0.5, 4);
    lvl.commit();
    // A third click carries the line on from the last point.
    lvl.addPoint(90, 5);
    expect(lvl.points[0]).toEqual({ x: 60, z: 5 });
    lvl.update(2);
    lvl.commit();
    const book = lvl.getSnapshot().book;
    expect(book).toHaveLength(2);
    expect(book.reduce((a, e) => a + e.rise, 0)).toBeCloseTo(-0.8, 4);
  });
});
