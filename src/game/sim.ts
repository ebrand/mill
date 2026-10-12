import RAPIER from '@dimforge/rapier3d-compat';
import { Vector3 } from 'three';
import { Boat, type BoatInput, type BoatSpec, DEFAULT_BOAT } from '../physics/boat';
import { sampleTerrain, toRapierHeights, type TerrainGrid } from '../world/terrain';
import { GerstnerOcean, type WaterSurface } from '../water/waves';

let rapierReady: Promise<void> | null = null;
export function initPhysics(): Promise<void> {
  rapierReady ??= RAPIER.init();
  return rapierReady;
}

export interface GameSimOptions {
  water?: WaterSurface & { setTime?(t: number): void };
  terrain?: TerrainGrid | null;
  boat?: BoatSpec;
  boatStart?: Vector3;
  dt?: number;
}

/**
 * Everything that advances on the fixed timestep. No rendering, no React: it runs
 * headless in tests.
 */
export class GameSim {
  readonly world: RAPIER.World;
  readonly water: WaterSurface & { setTime?(t: number): void };
  readonly boat: Boat;
  readonly terrain: TerrainGrid | null;
  readonly input: BoatInput = { throttle: 0, steer: 0 };
  /** Simulated time at the start of the next step. */
  time = 0;

  /** Call after initPhysics() has resolved. */
  constructor(opts: GameSimOptions = {}) {
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = opts.dt ?? 1 / 60;
    this.water = opts.water ?? new GerstnerOcean();
    this.terrain = opts.terrain === undefined ? sampleTerrain() : opts.terrain;

    if (this.terrain) {
      const n = this.terrain.resolution;
      this.world.createCollider(
        RAPIER.ColliderDesc.heightfield(
          n - 1,
          n - 1,
          toRapierHeights(this.terrain),
          { x: this.terrain.size, y: 1, z: this.terrain.size },
        ).setFriction(0.8),
      );
    }

    this.boat = new Boat(RAPIER, this.world, opts.boat ?? DEFAULT_BOAT, opts.boatStart ?? new Vector3(0, 0, 0));
    this.water.setTime?.(0);
  }

  step(): void {
    this.water.setTime?.(this.time);
    this.boat.applyForces(this.water, this.input);
    this.world.step();
    this.time += this.world.timestep;
  }

  dispose(): void {
    this.world.free();
  }
}
