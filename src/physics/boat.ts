import type RAPIER from '@dimforge/rapier3d-compat';
import { Quaternion, Vector3 } from 'three';
import { newSample, type WaterSurface } from '../water/waves';

export const WATER_DENSITY = 1025;
const G = 9.81;

export interface BoatSpec {
  halfWidth: number;
  halfHeight: number;
  halfLength: number;
  mass: number;
  /** Max propeller thrust in newtons. */
  thrust: number;
}

export const DEFAULT_BOAT: BoatSpec = {
  halfWidth: 0.8,
  halfHeight: 0.4,
  halfLength: 2.1,
  mass: 1200,
  thrust: 6000,
};

export interface BoatInput {
  /** -1..1, forward positive. */
  throttle: number;
  /** -1..1, positive turns right (to starboard, local -X). */
  steer: number;
}

// Linear and quadratic drag per buoyancy point, in the boat's local frame.
// Forward is light, sideways is heavy (keel), vertical damps heave/pitch/roll.
const DRAG_LINEAR = { side: 800, vertical: 600, forward: 60 };
const DRAG_QUADRATIC = { side: 300, vertical: 200, forward: 15 };
/** Depth over which drag fades in, so a point skimming the surface isn't fully dragged. */
const WET_DEPTH = 0.1;

/**
 * A rigid hull floated by sampling the water surface at points along its bottom.
 * Local frame: +Z is forward (bow), +Y up, -X starboard (right-handed).
 */
export class Boat {
  readonly body: RAPIER.RigidBody;
  /** Hull-bottom sample points in local space. */
  readonly points: Vector3[];
  private readonly cellVolume: number;
  private readonly columnHeight: number;

  // Scratch, to avoid per-step allocation.
  private readonly q = new Quaternion();
  private readonly qInv = new Quaternion();
  private readonly p = new Vector3();
  private readonly r = new Vector3();
  private readonly v = new Vector3();
  private readonly f = new Vector3();
  private readonly w = new Vector3();
  private readonly sample = newSample();

  /** Fraction of hull points below the surface, for debugging and tests. */
  submergedPoints = 0;

  constructor(
    rapier: typeof RAPIER,
    world: RAPIER.World,
    readonly spec: BoatSpec = DEFAULT_BOAT,
    position = new Vector3(0, 0, 0),
  ) {
    const { halfWidth: hx, halfHeight: hy, halfLength: hz, mass } = spec;
    this.body = world.createRigidBody(
      rapier.RigidBodyDesc.dynamic()
        .setTranslation(position.x, position.y, position.z)
        .setAngularDamping(0.5)
        .setCanSleep(false),
    );
    const volume = 8 * hx * hy * hz;
    world.createCollider(
      rapier.ColliderDesc.cuboid(hx, hy, hz).setDensity(mass / volume).setFriction(0.4),
      this.body,
    );

    const xs = [-0.75 * hx, 0.75 * hx];
    const zs = [-0.76 * hz, -0.26 * hz, 0.26 * hz, 0.76 * hz];
    this.points = [];
    for (const x of xs) for (const z of zs) this.points.push(new Vector3(x, -hy, z));
    this.cellVolume = volume / this.points.length;
    this.columnHeight = 2 * hy;
  }

  /**
   * Set buoyancy, drag and propulsion forces for the next step. They go through Rapier's
   * force accumulator (not impulses) so they're integrated the same way as gravity;
   * pre-step impulses left a residual velocity at rest that skewed the drag.
   */
  applyForces(water: WaterSurface, input: BoatInput): void {
    const body = this.body;
    body.resetForces(true);
    body.resetTorques(true);
    const t = body.translation();
    const rot = body.rotation();
    const lv = body.linvel();
    const av = body.angvel();
    this.q.set(rot.x, rot.y, rot.z, rot.w);
    this.qInv.copy(this.q).invert();
    this.w.set(av.x, av.y, av.z);

    let submerged = 0;
    let sternWet = 0;
    for (let i = 0; i < this.points.length; i++) {
      // Lever arm r = q * local; world point p = t + r.
      this.r.copy(this.points[i]).applyQuaternion(this.q);
      this.p.set(t.x + this.r.x, t.y + this.r.y, t.z + this.r.z);
      water.sample(this.p.x, this.p.z, this.sample);
      const depth = this.sample.height - this.p.y;
      if (depth <= 0) continue;
      submerged++;

      const fraction = Math.min(depth / this.columnHeight, 1);
      const wet = Math.min(depth / WET_DEPTH, 1);
      if (this.points[i].z < 0) sternWet += wet;

      // Point velocity relative to the moving water, in the boat's frame.
      this.v.crossVectors(this.w, this.r);
      this.v.x += lv.x - this.sample.vx;
      this.v.y += lv.y - this.sample.vy;
      this.v.z += lv.z - this.sample.vz;
      this.v.applyQuaternion(this.qInv);

      this.f.set(
        -wet * (DRAG_LINEAR.side * this.v.x + DRAG_QUADRATIC.side * this.v.x * Math.abs(this.v.x)),
        -wet * (DRAG_LINEAR.vertical * this.v.y + DRAG_QUADRATIC.vertical * this.v.y * Math.abs(this.v.y)),
        -wet * (DRAG_LINEAR.forward * this.v.z + DRAG_QUADRATIC.forward * this.v.z * Math.abs(this.v.z)),
      );
      this.f.applyQuaternion(this.q);
      this.f.y += WATER_DENSITY * G * this.cellVolume * fraction;
      body.addForceAtPoint(this.f, this.p, true);
    }
    this.submergedPoints = submerged / this.points.length;

    // Propeller and rudder only work when the stern is in the water.
    sternWet /= this.points.length / 2;
    if (sternWet > 0 && (input.throttle !== 0 || input.steer !== 0)) {
      const { halfLength, halfHeight, thrust } = this.spec;
      this.r.set(0, -halfHeight, -halfLength).applyQuaternion(this.q);
      this.p.set(t.x + this.r.x, t.y + this.r.y, t.z + this.r.z);

      this.v.set(lv.x, lv.y, lv.z).applyQuaternion(this.qInv);
      const forwardSpeed = this.v.z;
      const throttle = Math.max(-1, Math.min(1, input.throttle));
      const steer = Math.max(-1, Math.min(1, input.steer));
      const push = throttle * thrust * (throttle < 0 ? 0.4 : 1);

      // Rudder pushes the stern to port (+X) to turn the bow to starboard (-X). It needs
      // either flow past it or prop wash.
      const rudder = steer * (350 * forwardSpeed + 0.35 * Math.abs(push));
      this.f.set(rudder, 0, push).applyQuaternion(this.q).multiplyScalar(sternWet);
      body.addForceAtPoint(this.f, this.p, true);
    }
  }
}
