import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { islandHeight, sampleTerrain, toRapierHeights } from '../src/world/terrain';

beforeAll(async () => {
  await RAPIER.init();
});

describe('terrain heightfield', () => {
  it('has an island above sea level and sea floor around it', () => {
    expect(islandHeight(0, 0)).toBeGreaterThan(5);
    expect(islandHeight(300, 0)).toBeLessThan(-20);
  });

  it('Rapier collider matches islandHeight (catches axis/order mistakes)', () => {
    const grid = sampleTerrain();
    const n = grid.resolution;
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    world.createCollider(
      RAPIER.ColliderDesc.heightfield(n - 1, n - 1, toRapierHeights(grid), { x: grid.size, y: 1, z: grid.size }),
    );
    // Ray queries only see colliders after the broad phase has been updated by a step.
    world.step();
    let seed = 5;
    const r = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    let sumErr = 0;
    let maxErr = 0;
    let sumTransposedErr = 0;
    const N = 400;
    for (let i = 0; i < N; i++) {
      const x = (r() - 0.5) * 300;
      const z = (r() - 0.5) * 300;
      const hit = world.castRay(new RAPIER.Ray({ x, y: 100, z }, { x: 0, y: -1, z: 0 }), 500, true);
      expect(hit).not.toBeNull();
      const y = 100 - hit!.timeOfImpact;
      const err = Math.abs(y - islandHeight(x, z));
      sumErr += err;
      maxErr = Math.max(maxErr, err);
      sumTransposedErr += Math.abs(y - islandHeight(z, x));
    }
    console.log(`terrain collider mean err ${(sumErr / N).toFixed(3)} m, max ${maxErr.toFixed(3)} m, transposed mean ${(sumTransposedErr / N).toFixed(3)} m`);
    expect(sumErr / N).toBeLessThan(0.1);
    expect(maxErr).toBeLessThan(1);
    expect(sumTransposedErr / N).toBeGreaterThan(10 * (sumErr / N));
    world.free();
  });
});
