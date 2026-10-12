// 2D shallow-water solver: the local-inertial formulation (Bates, Horritt & Fewtrell 2010,
// "A simple inertial formulation of the shallow water equations...").
//
// - Water depth lives at cell centers; discharge per unit width lives on cell edges
//   (staggered grid), so mass is conserved exactly: every edge flux leaves one cell and
//   enters its neighbour.
// - Momentum drops the advection term (fine for the subcritical flow of a lowland river)
//   and uses semi-implicit Manning friction, which keeps it stable at shallow depths.
// - Flow depth across an edge is max(surface) - max(bed). That makes a lake at rest stay
//   at rest over uneven ground, and makes a raised step (a dam crest) behave like a weir.
// - A Froude limiter caps each edge at critical flow, |q| <= h * sqrt(g h). Without it the
//   model pushes water over drops several times too fast; with it, flow over a crest goes
//   critical and the broad-crested weir law (Q ~ 1.7 L H^1.5) emerges on its own.
// - Outflow limiting guarantees depth never goes negative.
//
// Plain TypeScript with typed arrays: it runs in a Web Worker and headless in tests.

export const G = 9.81;
/** Below this depth a cell is treated as dry. */
export const DRY = 1e-4;

export interface GridSpec {
  nx: number;
  nz: number;
  /** Cell size in meters. */
  dx: number;
  /** World position of the grid's (0, 0) corner. */
  x0: number;
  z0: number;
}

export interface Inflow {
  /** Cell indices along the west boundary (j values) that receive the inflow. */
  rows: number[];
  /** Total discharge in m^3/s. */
  discharge: number;
}

/**
 * A crest on one cell edge where flow follows the weir equation instead of the momentum
 * update. Plain terrain steps can't reproduce weir behaviour (see the Froude limiter note);
 * dams and spillways are built from these.
 */
export interface Weir {
  axis: 'x' | 'z';
  /** Index into qx or qz. */
  edge: number;
  /** Crest elevation (m). */
  crest: number;
  /** Discharge coefficient, SI. ~1.7 for a broad crest, ~1.8-2.2 for sharper ones. */
  coefficient: number;
}

export interface Outflow {
  /** Bed slope used to extrapolate a ghost cell beyond the east boundary. */
  slope: number;
}

export class ShallowWater {
  readonly nx: number;
  readonly nz: number;
  readonly dx: number;
  readonly x0: number;
  readonly z0: number;
  readonly bed: Float64Array;
  readonly depth: Float64Array;
  /** Unit discharge (m^2/s) on x-edges: index j * (nx + 1) + i is the edge left of cell i. */
  readonly qx: Float64Array;
  /** Unit discharge (m^2/s) on z-edges: index j * nx + i is the edge "below" cell (i, j). */
  readonly qz: Float64Array;
  manning = 0.035;
  inflow: Inflow | null = null;
  outflow: Outflow | null = null;
  /** Simulated seconds. */
  time = 0;
  /** Volume that has entered and left through boundaries (m^3), for mass-balance checks. */
  volumeIn = 0;
  volumeOut = 0;
  /** Discharge leaving through the east boundary on the last step (m^3/s). */
  lastOutflow = 0;
  private weirs: Weir[] = [];
  /** Total discharge over all weirs on the last step (m^3/s, absolute). */
  lastWeirFlow = 0;

  private readonly limit: Float64Array;

  constructor(spec: GridSpec, bed: Float64Array) {
    this.nx = spec.nx;
    this.nz = spec.nz;
    this.dx = spec.dx;
    this.x0 = spec.x0;
    this.z0 = spec.z0;
    const n = spec.nx * spec.nz;
    if (bed.length !== n) throw new Error(`bed has ${bed.length} cells, expected ${n}`);
    this.bed = bed;
    this.depth = new Float64Array(n);
    this.qx = new Float64Array((spec.nx + 1) * spec.nz);
    this.qz = new Float64Array(spec.nx * (spec.nz + 1));
    this.limit = new Float64Array(n);
  }

  addWeir(weir: Weir): void {
    this.weirs.push(weir);
  }

  cellX(i: number): number {
    return this.x0 + (i + 0.5) * this.dx;
  }
  cellZ(j: number): number {
    return this.z0 + (j + 0.5) * this.dx;
  }

  totalVolume(): number {
    let v = 0;
    for (let k = 0; k < this.depth.length; k++) v += this.depth[k];
    return v * this.dx * this.dx;
  }

  maxDepth(): number {
    let m = 0;
    for (let k = 0; k < this.depth.length; k++) if (this.depth[k] > m) m = this.depth[k];
    return m;
  }

  /** Largest stable timestep (Bates et al. use alpha ~ 0.7). */
  stableDt(alpha = 0.7): number {
    const h = Math.max(this.maxDepth(), 0.01);
    return (alpha * this.dx) / Math.sqrt(G * h);
  }

  /** Simulated time requested but not yet stepped (less than one step). */
  private pending = 0;
  private fixedDt = 0;
  private stepsSinceDt = 0;

  /**
   * Advance by `seconds` in whole fixed-length steps, carrying any remainder to the next
   * call. The step length only changes occasionally: alternating step lengths (e.g. a short
   * "leftover" step at the end of every call) excite oscillations in this staggered scheme.
   * Returns the number of steps taken.
   */
  advance(seconds: number, alpha = 0.7): number {
    this.pending += seconds;
    let steps = 0;
    for (;;) {
      if (this.fixedDt === 0 || this.stepsSinceDt >= 64) {
        this.fixedDt = this.stableDt(alpha);
        this.stepsSinceDt = 0;
      }
      if (this.pending < this.fixedDt) break;
      this.step(this.fixedDt);
      this.pending -= this.fixedDt;
      this.stepsSinceDt++;
      steps++;
      // Water deepening quickly (a flood) must shorten the step right away.
      if (steps % 8 === 0 && this.stableDt(alpha) < this.fixedDt * 0.9) this.fixedDt = 0;
    }
    return steps;
  }

  /** One explicit step of length dt. Caller is responsible for dt being stable. */
  step(dt: number): void {
    const { nx, nz, dx, bed, depth, qx, qz } = this;
    const n2 = this.manning * this.manning;
    const gdt = G * dt;

    const edge = (q: number, bL: number, hL: number, bR: number, hR: number): number => {
      const etaL = bL + hL;
      const etaR = bR + hR;
      const hf = Math.max(etaL, etaR) - Math.max(bL, bR);
      if (hf <= DRY) return 0;
      const slope = (etaR - etaL) / dx;
      // h^(7/3) = h^2 * cbrt(h)
      const friction = 1 + (gdt * n2 * Math.abs(q)) / (hf * hf * Math.cbrt(hf));
      const next = (q - gdt * hf * slope) / friction;
      const critical = hf * Math.sqrt(G * hf);
      return next > critical ? critical : next < -critical ? -critical : next;
    };

    // Interior x-edges.
    for (let j = 0; j < nz; j++) {
      const row = j * nx;
      const erow = j * (nx + 1);
      for (let i = 1; i < nx; i++) {
        const L = row + i - 1;
        const R = row + i;
        qx[erow + i] = edge(qx[erow + i], bed[L], depth[L], bed[R], depth[R]);
      }
      // West boundary: wall unless it's an inflow row (set below).
      qx[erow] = 0;
      // East boundary: ghost cell continuing the bed slope with the same depth.
      if (this.outflow) {
        const L = row + nx - 1;
        const bGhost = bed[L] - this.outflow.slope * dx;
        const q = edge(qx[erow + nx], bed[L], depth[L], bGhost, depth[L]);
        qx[erow + nx] = Math.max(q, 0);
      } else {
        qx[erow + nx] = 0;
      }
    }

    // Interior z-edges (edges at j = 0 and j = nz are walls).
    for (let j = 1; j < nz; j++) {
      const below = (j - 1) * nx;
      const above = j * nx;
      const erow = j * nx;
      for (let i = 0; i < nx; i++) {
        qz[erow + i] = edge(qz[erow + i], bed[below + i], depth[below + i], bed[above + i], depth[above + i]);
      }
    }

    for (const w of this.weirs) this.applyWeir(w);

    if (this.inflow && this.inflow.rows.length > 0) {
      const qPerWidth = this.inflow.discharge / (this.inflow.rows.length * dx);
      for (const j of this.inflow.rows) qx[j * (nx + 1)] = qPerWidth;
    }

    // Outflow limiting: no cell may lose more water than it holds this step.
    const limit = this.limit;
    const area = dx * dx;
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const c = j * nx + i;
        const ex = j * (nx + 1) + i;
        let out = 0;
        const qL = qx[ex];
        const qR = qx[ex + 1];
        const qB = qz[j * nx + i];
        const qT = qz[(j + 1) * nx + i];
        if (qL < 0) out -= qL;
        if (qR > 0) out += qR;
        if (qB < 0) out -= qB;
        if (qT > 0) out += qT;
        const outVolume = out * dx * dt;
        const available = depth[c] * area;
        limit[c] = outVolume > available ? available / outVolume : 1;
      }
    }
    // Scale each edge by the limit of the cell it drains.
    for (let j = 0; j < nz; j++) {
      const row = j * nx;
      const erow = j * (nx + 1);
      for (let i = 0; i <= nx; i++) {
        const q = qx[erow + i];
        if (q > 0 && i > 0) qx[erow + i] = q * limit[row + i - 1];
        else if (q < 0 && i < nx) qx[erow + i] = q * limit[row + i];
      }
    }
    for (let j = 1; j < nz; j++) {
      const erow = j * nx;
      for (let i = 0; i < nx; i++) {
        const q = qz[erow + i];
        if (q > 0) qz[erow + i] = q * limit[(j - 1) * nx + i];
        else if (q < 0) qz[erow + i] = q * limit[j * nx + i];
      }
    }

    let weirFlow = 0;
    for (const w of this.weirs) weirFlow += Math.abs(w.axis === 'x' ? qx[w.edge] : qz[w.edge]);
    this.lastWeirFlow = weirFlow * dx;

    // Continuity.
    const k = dt / dx;
    let inflowRate = 0;
    let outflowRate = 0;
    for (let j = 0; j < nz; j++) {
      const erow = j * (nx + 1);
      inflowRate += qx[erow] * dx;
      outflowRate += qx[erow + nx] * dx;
      for (let i = 0; i < nx; i++) {
        const c = j * nx + i;
        const net = qx[erow + i] - qx[erow + i + 1] + qz[j * nx + i] - qz[(j + 1) * nx + i];
        const d = depth[c] + k * net;
        depth[c] = d > 0 ? d : 0;
      }
    }
    this.volumeIn += inflowRate * dt;
    this.volumeOut += outflowRate * dt;
    this.lastOutflow = outflowRate;
    this.time += dt;
  }

  /** Unit discharge over a weir edge: free flow C H^1.5, reduced when drowned (Villemonte). */
  private applyWeir(w: Weir): number {
    const { nx, bed, depth } = this;
    let a: number;
    let b: number;
    if (w.axis === 'x') {
      const j = Math.floor(w.edge / (nx + 1));
      const i = w.edge - j * (nx + 1);
      if (i === 0 || i === nx) return 0;
      a = j * nx + i - 1;
      b = j * nx + i;
    } else {
      const j = Math.floor(w.edge / nx);
      const i = w.edge - j * nx;
      if (j === 0 || j === this.nz) return 0;
      a = (j - 1) * nx + i;
      b = j * nx + i;
    }
    const etaA = bed[a] + depth[a];
    const etaB = bed[b] + depth[b];
    const up = Math.max(etaA, etaB);
    const down = Math.min(etaA, etaB);
    // Head can't exceed the water actually standing upstream (dry high ground has none).
    const H = Math.min(up - w.crest, etaA >= etaB ? depth[a] : depth[b]);
    let q = 0;
    if (H > DRY) {
      q = w.coefficient * H * Math.sqrt(H);
      const Hd = down - w.crest;
      if (Hd > 0) q *= Math.pow(Math.max(0, 1 - Math.pow(Hd / H, 1.5)), 0.385);
    }
    const signed = etaA >= etaB ? q : -q;
    if (w.axis === 'x') this.qx[w.edge] = signed;
    else this.qz[w.edge] = signed;
    return signed;
  }

  /** Cell-center velocity (m/s), averaging the two edges on each axis. */
  velocity(i: number, j: number, out: { u: number; w: number }): { u: number; w: number } {
    const c = j * this.nx + i;
    const d = this.depth[c];
    if (d <= 0.01) {
      out.u = 0;
      out.w = 0;
      return out;
    }
    const ex = j * (this.nx + 1) + i;
    out.u = (this.qx[ex] + this.qx[ex + 1]) / (2 * d);
    out.w = (this.qz[j * this.nx + i] + this.qz[(j + 1) * this.nx + i]) / (2 * d);
    return out;
  }
}
