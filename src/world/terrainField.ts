// Editable terrain: heights and ground material on a regular grid of samples. The samples sit
// exactly at the water sim's cell centers, so the sim's bed *is* this terrain (no resampling)
// and the water and terrain meshes share vertex positions along the banks.

export enum Material {
  Soil = 0,
  Gravel = 1,
  Rock = 2,
}

/** How fast each material digs, relative to soil. Ledge rock barely moves with hand tools. */
export const DIG_RATE: Record<Material, number> = {
  [Material.Soil]: 1,
  [Material.Gravel]: 0.7,
  [Material.Rock]: 0.1,
};

export interface FieldSpec {
  nx: number;
  nz: number;
  /** Sample spacing in meters. */
  dx: number;
  /** World position of the grid's (0, 0) corner; sample (i, j) is at x0 + (i + 0.5) dx. */
  x0: number;
  z0: number;
}

/** Inclusive-exclusive sample rectangle [i0, i1) x [j0, j1). */
export interface Rect {
  i0: number;
  j0: number;
  i1: number;
  j1: number;
}

export interface EditResult {
  dirty: Rect | null;
  /** Volumes in m^3, positive. */
  cut: number;
  fill: number;
}

export class TerrainField {
  readonly nx: number;
  readonly nz: number;
  readonly dx: number;
  readonly x0: number;
  readonly z0: number;
  readonly heights: Float32Array;
  readonly material: Uint8Array;

  constructor(spec: FieldSpec) {
    this.nx = spec.nx;
    this.nz = spec.nz;
    this.dx = spec.dx;
    this.x0 = spec.x0;
    this.z0 = spec.z0;
    this.heights = new Float32Array(spec.nx * spec.nz);
    this.material = new Uint8Array(spec.nx * spec.nz);
  }

  get spec(): FieldSpec {
    return { nx: this.nx, nz: this.nz, dx: this.dx, x0: this.x0, z0: this.z0 };
  }

  sampleX(i: number): number {
    return this.x0 + (i + 0.5) * this.dx;
  }
  sampleZ(j: number): number {
    return this.z0 + (j + 0.5) * this.dx;
  }

  /** Fill from a height function and material rule. */
  generate(height: (x: number, z: number) => number, material: (x: number, z: number, h: number) => Material) {
    for (let j = 0; j < this.nz; j++) {
      const z = this.sampleZ(j);
      for (let i = 0; i < this.nx; i++) {
        const x = this.sampleX(i);
        const h = height(x, z);
        this.heights[j * this.nx + i] = h;
        this.material[j * this.nx + i] = material(x, z, h);
      }
    }
  }

  /** Bilinear height at a world position (clamped to the grid). */
  heightAt(x: number, z: number): number {
    const fx = Math.min(Math.max((x - this.x0) / this.dx - 0.5, 0), this.nx - 1.0001);
    const fz = Math.min(Math.max((z - this.z0) / this.dx - 0.5, 0), this.nz - 1.0001);
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const tx = fx - i;
    const tz = fz - j;
    const k = j * this.nx + i;
    const h = this.heights;
    const a = h[k] + (h[k + 1] - h[k]) * tx;
    const b = h[k + this.nx] + (h[k + this.nx + 1] - h[k + this.nx]) * tx;
    return a + (b - a) * tz;
  }

  /**
   * First intersection of a ray with the terrain, by marching and then bisecting.
   * Returns [x, y, z] or null if it misses within maxDistance.
   */
  raycast(origin: [number, number, number], dir: [number, number, number], maxDistance = 2000): [number, number, number] | null {
    const len = Math.hypot(dir[0], dir[1], dir[2]);
    const d = [dir[0] / len, dir[1] / len, dir[2] / len];
    const at = (t: number) => [origin[0] + d[0] * t, origin[1] + d[1] * t, origin[2] + d[2] * t];
    const above = (t: number) => {
      const p = at(t);
      return p[1] - this.heightAt(p[0], p[2]);
    };
    const step = this.dx * 0.5;
    let prevT = 0;
    let prev = above(0);
    if (prev < 0) return null;
    for (let t = step; t <= maxDistance; t += step) {
      const p = at(t);
      if (p[0] < this.x0 || p[2] < this.z0 || p[0] > this.x0 + this.nx * this.dx || p[2] > this.z0 + this.nz * this.dx) {
        if (d[1] >= 0) return null;
        prevT = t;
        prev = above(t);
        continue;
      }
      const cur = above(t);
      if (cur <= 0) {
        let lo = prevT;
        let hi = t;
        for (let k = 0; k < 20; k++) {
          const mid = (lo + hi) / 2;
          if (above(mid) > 0) lo = mid;
          else hi = mid;
        }
        const hit = at(hi);
        return [hit[0], hit[1], hit[2]];
      }
      prevT = t;
      prev = cur;
    }
    return null;
  }

  /**
   * Raise (amount > 0) or lower (amount < 0) the ground around (x, z) with a smooth falloff.
   * amount is the change in meters at the center for this call; digging is scaled by the
   * material's dig rate. Returns the changed rectangle and volumes moved.
   */
  brush(x: number, z: number, radius: number, amount: number): EditResult {
    const { nx, nz, dx } = this;
    const i0 = Math.max(0, Math.floor((x - radius - this.x0) / dx - 0.5));
    const i1 = Math.min(nx, Math.ceil((x + radius - this.x0) / dx + 0.5));
    const j0 = Math.max(0, Math.floor((z - radius - this.z0) / dx - 0.5));
    const j1 = Math.min(nz, Math.ceil((z + radius - this.z0) / dx + 0.5));
    let cut = 0;
    let fill = 0;
    let dirty: Rect | null = null;
    const area = dx * dx;
    for (let j = j0; j < j1; j++) {
      for (let i = i0; i < i1; i++) {
        const r = Math.hypot(this.sampleX(i) - x, this.sampleZ(j) - z) / radius;
        if (r >= 1) continue;
        // Smooth bump: 1 at the center, 0 with zero slope at the edge.
        const w = (1 - r * r) * (1 - r * r);
        const k = j * nx + i;
        let delta = amount * w;
        if (delta < 0) delta *= DIG_RATE[this.material[k] as Material];
        if (delta === 0) continue;
        this.heights[k] += delta;
        if (delta < 0) cut -= delta * area;
        else fill += delta * area;
        if (!dirty) dirty = { i0: i, j0: j, i1: i + 1, j1: j + 1 };
        else {
          dirty.i0 = Math.min(dirty.i0, i);
          dirty.j0 = Math.min(dirty.j0, j);
          dirty.i1 = Math.max(dirty.i1, i + 1);
          dirty.j1 = Math.max(dirty.j1, j + 1);
        }
      }
    }
    return { dirty, cut, fill };
  }

  /** Copy of the heights inside a rectangle, row-major. */
  extract(rect: Rect): Float32Array {
    const w = rect.i1 - rect.i0;
    const out = new Float32Array(w * (rect.j1 - rect.j0));
    for (let j = rect.j0; j < rect.j1; j++) {
      out.set(this.heights.subarray(j * this.nx + rect.i0, j * this.nx + rect.i1), (j - rect.j0) * w);
    }
    return out;
  }
}

export function unionRect(a: Rect | null, b: Rect | null): Rect | null {
  if (!a) return b;
  if (!b) return a;
  return { i0: Math.min(a.i0, b.i0), j0: Math.min(a.j0, b.j0), i1: Math.max(a.i1, b.i1), j1: Math.max(a.j1, b.j1) };
}
