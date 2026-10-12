// CPU-side Gerstner wave model. The GPU evaluates the same waves (see oceanNodes.ts);
// tests/parity checks keep the two in agreement.

export const GRAVITY = 9.81;
const TWO_PI = Math.PI * 2;

export interface WaveSpec {
  /** Direction of travel in the XZ plane (normalized internally). */
  dirX: number;
  dirZ: number;
  wavelength: number;
  amplitude: number;
  /** 0..1. Sum over waves of steepness / count <= 1 guarantees no surface loops. */
  steepness: number;
}

/** Derived per-wave constants, laid out flat so the GPU uniforms are a straight copy. */
export interface Wave {
  dx: number;
  dz: number;
  k: number;
  amplitude: number;
  /** Horizontal displacement factor Q, already divided so that sum(Q*k*A) <= 1. */
  q: number;
  omega: number;
}

export interface WaterSample {
  height: number;
  /** Surface (orbital) velocity of the water particle at this point. */
  vx: number;
  vy: number;
  vz: number;
}

/** Anything physics can float on. Gerstner today; Gerstner + shallow water later. */
export interface WaterSurface {
  sample(x: number, z: number, out: WaterSample): WaterSample;
}

export function buildWaves(specs: readonly WaveSpec[]): Wave[] {
  const n = specs.length;
  return specs.map((s) => {
    const len = Math.hypot(s.dirX, s.dirZ);
    if (len === 0) throw new Error('wave direction must be non-zero');
    const k = TWO_PI / s.wavelength;
    return {
      dx: s.dirX / len,
      dz: s.dirZ / len,
      k,
      amplitude: s.amplitude,
      q: s.amplitude > 0 ? s.steepness / (k * s.amplitude * n) : 0,
      // Deep-water dispersion.
      omega: Math.sqrt(GRAVITY * k),
    };
  });
}

/** Moderate sea, wind roughly along +X. Peak-to-trough on the order of 1.5 m. */
export const DEFAULT_SEA: readonly WaveSpec[] = [
  { dirX: 1.0, dirZ: 0.15, wavelength: 61, amplitude: 0.55, steepness: 0.55 },
  { dirX: 0.9, dirZ: -0.35, wavelength: 37, amplitude: 0.32, steepness: 0.6 },
  { dirX: 0.8, dirZ: 0.6, wavelength: 23, amplitude: 0.18, steepness: 0.6 },
  { dirX: 1.0, dirZ: -0.1, wavelength: 14.5, amplitude: 0.11, steepness: 0.65 },
  { dirX: 0.55, dirZ: -0.85, wavelength: 9.3, amplitude: 0.065, steepness: 0.6 },
  { dirX: 0.95, dirZ: 0.3, wavelength: 6.1, amplitude: 0.04, steepness: 0.55 },
  { dirX: 0.3, dirZ: 0.95, wavelength: 4.1, amplitude: 0.025, steepness: 0.5 },
  { dirX: 0.75, dirZ: -0.65, wavelength: 2.7, amplitude: 0.015, steepness: 0.45 },
];

export const WAVE_COUNT = DEFAULT_SEA.length;

/**
 * Gerstner ocean evaluated on the CPU in float64.
 *
 * Phases are kept as (omega * t) mod 2pi in float64 and handed to the GPU as-is, so the
 * float32 shader never sees a large time value.
 */
export class GerstnerOcean implements WaterSurface {
  readonly waves: Wave[];
  readonly phase: Float64Array;
  private time = 0;

  constructor(readonly specs: readonly WaveSpec[] = DEFAULT_SEA) {
    this.waves = buildWaves(specs);
    this.phase = new Float64Array(this.waves.length);
  }

  get currentTime(): number {
    return this.time;
  }

  setTime(t: number): void {
    this.time = t;
    for (let i = 0; i < this.waves.length; i++) {
      const p = (this.waves[i].omega * t) % TWO_PI;
      this.phase[i] = p < 0 ? p + TWO_PI : p;
    }
  }

  /**
   * Displaced position of the undisplaced surface point (px, pz).
   * Writes [X, Y, Z] into out.
   */
  displace(px: number, pz: number, out: Float64Array | number[]): void {
    let x = px;
    let y = 0;
    let z = pz;
    for (let i = 0; i < this.waves.length; i++) {
      const w = this.waves[i];
      const theta = w.k * (w.dx * px + w.dz * pz) - this.phase[i];
      const c = Math.cos(theta);
      const qa = w.q * w.amplitude;
      x += qa * w.dx * c;
      z += qa * w.dz * c;
      y += w.amplitude * Math.sin(theta);
    }
    out[0] = x;
    out[1] = y;
    out[2] = z;
  }

  /**
   * Gerstner moves surface points horizontally, so the height at world (x, z) is not the
   * height of the undisplaced point (x, z). Solve p + D(p) = (x, z) by fixed-point
   * iteration; it contracts because sum(Q*k*A) <= 1.
   * Returns the undisplaced point in out[0], out[1].
   */
  invert(x: number, z: number, out: Float64Array | number[], iterations = 6): void {
    let px = x;
    let pz = z;
    for (let it = 0; it < iterations; it++) {
      let ox = 0;
      let oz = 0;
      for (let i = 0; i < this.waves.length; i++) {
        const w = this.waves[i];
        const c = Math.cos(w.k * (w.dx * px + w.dz * pz) - this.phase[i]);
        const qa = w.q * w.amplitude;
        ox += qa * w.dx * c;
        oz += qa * w.dz * c;
      }
      px = x - ox;
      pz = z - oz;
    }
    out[0] = px;
    out[1] = pz;
  }

  private readonly scratch = new Float64Array(2);

  sample(x: number, z: number, out: WaterSample): WaterSample {
    this.invert(x, z, this.scratch);
    const px = this.scratch[0];
    const pz = this.scratch[1];
    let y = 0;
    let vx = 0;
    let vy = 0;
    let vz = 0;
    for (let i = 0; i < this.waves.length; i++) {
      const w = this.waves[i];
      const theta = w.k * (w.dx * px + w.dz * pz) - this.phase[i];
      const s = Math.sin(theta);
      const c = Math.cos(theta);
      y += w.amplitude * s;
      // d(theta)/dt = -omega
      const qaw = w.q * w.amplitude * w.omega;
      vx += qaw * w.dx * s;
      vz += qaw * w.dz * s;
      vy -= w.amplitude * w.omega * c;
    }
    out.height = y;
    out.vx = vx;
    out.vy = vy;
    out.vz = vz;
    return out;
  }
}

/** Calm water at a fixed level. Useful for tests. */
export class FlatWater implements WaterSurface {
  constructor(readonly level = 0) {}
  sample(_x: number, _z: number, out: WaterSample): WaterSample {
    out.height = this.level;
    out.vx = 0;
    out.vy = 0;
    out.vz = 0;
    return out;
  }
}

export function newSample(): WaterSample {
  return { height: 0, vx: 0, vy: 0, vz: 0 };
}
