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
// - Each edge's previous discharge is blended with its two neighbours along the flow
//   direction (theta weighting, de Almeida et al. 2012). The plain scheme develops
//   checkerboard oscillations in narrow, deep, low-friction channels; this damps them.
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

/**
 * A gate: weir flow over its sill while the water is below the gate's lip, orifice flow
 * under the lip once it's covered. Taking the smaller of the two keeps the change-over
 * continuous. Q in m^3/s for a gate `width` wide with its bottom (sill) at `sill` and
 * raised `opening` meters; free discharge (tailwater below the opening) is assumed.
 */
export function gateDischarge(etaUp: number, sill: number, opening: number, width: number, cd = 0.6, cWeir = 1.7): number {
  const H = etaUp - sill;
  if (H <= 0 || opening <= 0 || width <= 0) return 0;
  const weir = cWeir * width * H * Math.sqrt(H);
  // Orifice flow only once the water covers the lip; below that the gate is just a sill.
  if (H <= opening) return weir;
  const orifice = cd * width * opening * Math.sqrt(2 * G * (H - opening / 2));
  return Math.min(weir, orifice);
}

/**
 * A structure that carries water between two groups of cells that needn't be neighbours:
 * a head gate into a flume, a wheel, a culvert. Mass is moved exactly: what leaves `from`
 * arrives in `to`.
 */
export interface Link {
  id: string;
  /** Cells the water is drawn from (the forebay). */
  from: number[];
  /** Cells it's delivered to (the tailrace). */
  to: number[];
  /** Gate sill elevation, m. */
  sill: number;
  /** Gate width, m. */
  width: number;
  /** Gate opening, m (0 = shut). */
  opening: number;
  /** Most the structure can pass regardless of the gate (e.g. a wheel's bucket capacity), m^3/s. */
  maxDischarge: number;
}

export interface LinkState {
  /** Discharge on the last step, m^3/s. */
  discharge: number;
  /** Mean water surface at the intake and outlet, m. */
  etaFrom: number;
  etaTo: number;
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
  /** Weight on an edge's own previous discharge (1 = plain Bates scheme). */
  theta = 0.9;
  /**
   * Courant number for the step length. Bates et al. use 0.7, but with theta weighting
   * that blows up (measured: a lake at rest went unstable); 0.5 is stable and still let
   * a narrow channel settle to steady flow, which 0.7 didn't.
   */
  courant = 0.5;
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
  readonly links = new Map<string, Link>();
  readonly linkState = new Map<string, LinkState>();
  /** Total discharge over all weirs on the last step (m^3/s, absolute). */
  lastWeirFlow = 0;

  private readonly limit: Float64Array;
  private readonly qxOld: Float64Array;
  private readonly qzOld: Float64Array;

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
    this.qxOld = new Float64Array(this.qx.length);
    this.qzOld = new Float64Array(this.qz.length);
  }

  addWeir(weir: Weir): void {
    this.weirs.push(weir);
  }

  setLink(link: Link): void {
    this.links.set(link.id, link);
    if (!this.linkState.has(link.id)) this.linkState.set(link.id, { discharge: 0, etaFrom: 0, etaTo: 0 });
  }

  removeLink(id: string): void {
    this.links.delete(id);
    this.linkState.delete(id);
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

  /** Largest stable timestep for Courant number `alpha`. */
  stableDt(alpha = this.courant): number {
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
  advance(seconds: number, alpha = this.courant): number {
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
    const theta = this.theta;
    const side = (1 - theta) / 2;
    const qxOld = this.qxOld;
    const qzOld = this.qzOld;
    qxOld.set(qx);
    qzOld.set(qz);

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
        const e = erow + i;
        const qBlend = theta * qxOld[e] + side * (qxOld[e - 1] + qxOld[e + 1]);
        qx[e] = edge(qBlend, bed[L], depth[L], bed[R], depth[R]);
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
        const e = erow + i;
        const qBlend = theta * qzOld[e] + side * (qzOld[e - nx] + qzOld[e + nx]);
        qz[e] = edge(qBlend, bed[below + i], depth[below + i], bed[above + i], depth[above + i]);
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
    this.applyLinks(dt);
    this.volumeIn += inflowRate * dt;
    this.volumeOut += outflowRate * dt;
    this.lastOutflow = outflowRate;
    this.time += dt;
  }

  /** Move water through every link for one step, never taking more than the intake holds. */
  private applyLinks(dt: number): void {
    const area = this.dx * this.dx;
    const { bed, depth } = this;
    for (const link of this.links.values()) {
      const state = this.linkState.get(link.id)!;
      let available = 0;
      let etaFrom = 0;
      for (const c of link.from) {
        available += depth[c] * area;
        etaFrom += bed[c] + depth[c];
      }
      etaFrom /= Math.max(link.from.length, 1);
      let etaTo = 0;
      for (const c of link.to) etaTo += bed[c] + depth[c];
      etaTo /= Math.max(link.to.length, 1);

      let q = Math.min(gateDischarge(etaFrom, link.sill, link.opening, link.width), link.maxDischarge);
      // Water can't run uphill through a structure.
      if (etaTo >= etaFrom) q = 0;
      let volume = Math.min(q * dt, available * 0.9);
      if (volume <= 0) volume = 0;
      if (volume > 0) {
        // Draw from intake cells in proportion to what each holds; deliver evenly.
        const take = volume / available;
        for (const c of link.from) depth[c] -= depth[c] * take;
        const add = volume / area / link.to.length;
        for (const c of link.to) depth[c] += add;
      }
      state.discharge = volume / dt;
      state.etaFrom = etaFrom;
      state.etaTo = etaTo;
    }
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
