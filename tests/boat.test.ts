import { beforeAll, describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { GameSim, initPhysics } from '../src/game/sim';
import { DEFAULT_BOAT, WATER_DENSITY } from '../src/physics/boat';
import { FlatWater, GerstnerOcean } from '../src/water/waves';
import { islandHeight } from '../src/world/terrain';

beforeAll(async () => {
  await initPhysics();
});

function run(sim: GameSim, seconds: number, each?: () => void) {
  const steps = Math.round(seconds * 60);
  for (let i = 0; i < steps; i++) {
    sim.step();
    each?.();
  }
}

function pose(sim: GameSim) {
  const t = sim.boat.body.translation();
  const r = sim.boat.body.rotation();
  const q = new Quaternion(r.x, r.y, r.z, r.w);
  return {
    pos: new Vector3(t.x, t.y, t.z),
    up: new Vector3(0, 1, 0).applyQuaternion(q),
    forward: new Vector3(0, 0, 1).applyQuaternion(q),
  };
}

describe('boat buoyancy', () => {
  it('settles at the Archimedes draft on flat water', () => {
    const sim = new GameSim({ water: new FlatWater(0), terrain: null, boatStart: new Vector3(0, 1.5, 0) });
    run(sim, 15);
    const { halfWidth, halfLength, halfHeight, mass } = DEFAULT_BOAT;
    const draft = mass / (WATER_DENSITY * 4 * halfWidth * halfLength);
    const p = pose(sim);
    console.log(`flat water: center y ${p.pos.y.toFixed(4)}, expected ${(halfHeight - draft).toFixed(4)}`);
    expect(p.pos.y).toBeCloseTo(halfHeight - draft, 2);
    expect(p.up.y).toBeGreaterThan(0.9999);
    const v = sim.boat.body.linvel();
    expect(Math.hypot(v.x, v.y, v.z)).toBeLessThan(0.01);
    sim.dispose();
  });

  it('rides a Gerstner sea for 2 minutes without sinking, flipping or blowing up', () => {
    const ocean = new GerstnerOcean();
    const sim = new GameSim({ water: ocean, terrain: null });
    let minUp = 1;
    let maxOffset = 0;
    const s = { height: 0, vx: 0, vy: 0, vz: 0 };
    run(sim, 120, () => {
      const p = pose(sim);
      expect(Number.isFinite(p.pos.y)).toBe(true);
      minUp = Math.min(minUp, p.up.y);
      ocean.sample(p.pos.x, p.pos.z, s);
      maxOffset = Math.max(maxOffset, Math.abs(p.pos.y - s.height));
    });
    const p = pose(sim);
    console.log(`sea: min up.y ${minUp.toFixed(3)}, max |boat y - water y| ${maxOffset.toFixed(3)} m, drift ${Math.hypot(p.pos.x, p.pos.z).toFixed(1)} m`);
    expect(minUp).toBeGreaterThan(0.7);
    expect(maxOffset).toBeLessThan(1.0);
    sim.dispose();
  });

  it('drives forward under throttle at a plausible speed', () => {
    const sim = new GameSim({ water: new FlatWater(0), terrain: null });
    sim.input.throttle = 1;
    run(sim, 30);
    const v = sim.boat.body.linvel();
    const p = pose(sim);
    console.log(`throttle: v = (${v.x.toFixed(2)}, ${v.y.toFixed(2)}, ${v.z.toFixed(2)}), up.y ${p.up.y.toFixed(3)}`);
    expect(v.z).toBeGreaterThan(3);
    expect(v.z).toBeLessThan(9);
    expect(Math.abs(v.x)).toBeLessThan(0.1);
    expect(p.up.y).toBeGreaterThan(0.95);
    sim.dispose();
  });

  it('turns right (toward -X) on positive steer', () => {
    const sim = new GameSim({ water: new FlatWater(0), terrain: null });
    sim.input.throttle = 1;
    run(sim, 5);
    sim.input.steer = 1;
    run(sim, 2);
    const f = pose(sim).forward;
    console.log(`steer right: forward = (${f.x.toFixed(2)}, ${f.z.toFixed(2)})`);
    expect(f.x).toBeLessThan(-0.2);
    sim.dispose();
  });

  it('runs aground on the island instead of passing through it', () => {
    const sim = new GameSim({ boatStart: new Vector3(0, 0, -200) });
    sim.input.throttle = 1;
    let minClearance = Infinity;
    run(sim, 90, () => {
      const p = pose(sim);
      minClearance = Math.min(minClearance, p.pos.y - islandHeight(p.pos.x, p.pos.z));
    });
    const p = pose(sim);
    console.log(`aground at (${p.pos.x.toFixed(1)}, ${p.pos.y.toFixed(2)}, ${p.pos.z.toFixed(1)}), terrain ${islandHeight(p.pos.x, p.pos.z).toFixed(2)}, min clearance ${minClearance.toFixed(2)}`);
    // Stopped before the island's center and never sank into the ground.
    expect(p.pos.z).toBeLessThan(0);
    expect(p.pos.z).toBeGreaterThan(-150);
    expect(minClearance).toBeGreaterThan(0);
    sim.dispose();
  });
});
