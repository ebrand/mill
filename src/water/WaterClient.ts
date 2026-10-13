import { DataTexture, FloatType, LinearFilter, RGBAFormat } from 'three';
import { RIVER_DISCHARGE } from '../scene/site';
import type { Rect, TerrainField } from '../world/terrainField';
import type { FromWorker, GridInfo, SimStats, ToWorker } from './protocol';
import type { Link } from './shallowWater';
import { STATE_STRIDE } from './protocol';

export interface WaterClientOptions {
  /** The terrain the river runs over; the sim grid matches its samples. */
  terrain: TerrainField;
  prefill: boolean;
  /** Start from saved water instead (see saveGame.ts). */
  depth?: Float32Array;
  time?: number;
}

/**
 * Main-thread side of the water sim: owns the worker, the two state buffers it alternates
 * between, and the GPU texture the water surface reads.
 */
export class WaterClient {
  grid: GridInfo | null = null;
  texture: DataTexture | null = null;
  stats: SimStats | null = null;
  /** Simulated seconds per real second. 0 pauses. */
  speed = 1;
  discharge = RIVER_DISCHARGE;
  error: string | null = null;

  private worker: Worker;
  private spare: ArrayBuffer | null = null;
  private inFlight = false;
  /** Simulated time owed to the worker while a request was in flight. */
  private owed = 0;
  private readyResolve!: () => void;
  readonly ready: Promise<void>;

  constructor(private readonly options: WaterClientOptions) {
    this.ready = new Promise((r) => (this.readyResolve = r));
    this.worker = this.start();
  }

  private start(): Worker {
    const worker = new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<FromWorker>) => this.onMessage(e.data);
    worker.onerror = (e) => {
      this.error = e.message || 'water worker failed';
    };
    const t = this.options.terrain;
    // Copied (not transferred): the main thread keeps editing its terrain.
    const o = this.options;
    this.send(worker, {
      type: 'init',
      prefill: o.prefill,
      discharge: this.discharge,
      grid: t.spec,
      heights: t.heights.slice(),
      depth: o.depth,
      time: o.time,
    });
    // Structures survive restarts (load, reset).
    for (const link of this.links?.values() ?? []) this.send(worker, { type: 'link', link });
    return worker;
  }

  private send(worker: Worker, msg: ToWorker, transfer: Transferable[] = []) {
    worker.postMessage(msg, transfer);
  }

  private snapshots = new Map<number, (r: { depth: Float32Array; time: number }) => void>();
  private nextSnapshot = 1;

  /** The worker's current water depths (for saving). */
  snapshot(): Promise<{ depth: Float32Array; time: number }> {
    const id = this.nextSnapshot++;
    return new Promise((resolve) => {
      this.snapshots.set(id, resolve);
      this.send(this.worker, { type: 'snapshot', id });
    });
  }

  private onMessage(msg: FromWorker) {
    if (msg.type === 'snapshot') {
      this.snapshots.get(msg.id)?.({ depth: msg.depth, time: msg.time });
      this.snapshots.delete(msg.id);
      return;
    }
    if (msg.type === 'error') {
      this.error = msg.message;
      console.error('[water]', msg.message);
      return;
    }
    if (msg.type === 'ready') {
      this.grid = msg.grid;
      const size = msg.grid.nx * msg.grid.nz * STATE_STRIDE;
      if (!this.texture || this.texture.image.width !== msg.grid.nx) {
        const data = new Float32Array(size);
        const tex = new DataTexture(data, msg.grid.nx, msg.grid.nz, RGBAFormat, FloatType);
        tex.magFilter = LinearFilter;
        tex.minFilter = LinearFilter;
        tex.needsUpdate = true;
        this.texture = tex;
      }
      this.spare = new ArrayBuffer(size * 4);
      this.inFlight = false;
      this.owed = 0;
      // Ask for an initial state straight away so there's water before time moves.
      this.request(0);
      this.readyResolve();
      return;
    }
    if (msg.type === 'state') {
      (this.texture!.image.data as Float32Array).set(new Float32Array(msg.buffer));
      this.texture!.needsUpdate = true;
      this.stats = msg.stats;
      this.spare = msg.buffer;
      this.inFlight = false;
    }
  }

  private request(seconds: number) {
    if (!this.spare) return;
    const buffer = this.spare;
    this.spare = null;
    this.inFlight = true;
    this.send(this.worker, { type: 'step', seconds, buffer }, [buffer]);
  }

  /** Call once per frame with real elapsed seconds. */
  update(delta: number) {
    if (!this.grid) return;
    this.owed += Math.min(delta, 0.25) * this.speed;
    if (!this.inFlight) {
      const seconds = this.owed;
      this.owed = 0;
      this.request(seconds);
    }
  }

  /**
   * Water at a world position from the latest state: surface elevation and depth (0 if
   * dry). Null before the first state arrives or outside the grid.
   */
  surfaceAt(x: number, z: number): { eta: number; depth: number } | null {
    const g = this.grid;
    const data = this.texture?.image.data as Float32Array | undefined;
    if (!g || !data || !this.stats) return null;
    const i = Math.floor((x - g.x0) / g.dx);
    const j = Math.floor((z - g.z0) / g.dx);
    if (i < 0 || j < 0 || i >= g.nx || j >= g.nz) return null;
    const o = (j * g.nx + i) * STATE_STRIDE;
    const depth = data[o + 1];
    return { eta: data[o], depth: depth > 0 ? depth : 0 };
  }

  /** Lowest water surface among wet cells within `radius` of a point (e.g. the tailwater). */
  lowestWaterNear(x: number, z: number, radius: number): number | null {
    const g = this.grid;
    if (!g) return null;
    let best: number | null = null;
    for (let dz = -radius; dz <= radius; dz += g.dx) {
      for (let dx = -radius; dx <= radius; dx += g.dx) {
        if (dx * dx + dz * dz > radius * radius) continue;
        const w = this.surfaceAt(x + dx, z + dz);
        if (w && w.depth > 0.05 && (best === null || w.eta < best)) best = w.eta;
      }
    }
    return best;
  }

  /** Send edited terrain for a rectangle of samples to the sim. */
  updateBed(rect: Rect) {
    // No readiness check: messages queue in order behind 'init', so early edits still land.
    const heights = this.options.terrain.extract(rect);
    this.send(this.worker, { type: 'bed', rect, heights }, [heights.buffer]);
  }

  /** Links are re-sent after a restart, so callers set them once. */
  private links = new Map<string, Link>();

  setLink(link: Link) {
    this.links.set(link.id, link);
    this.send(this.worker, { type: 'link', link });
  }

  setDischarge(value: number) {
    this.discharge = Math.max(0, value);
    this.send(this.worker, { type: 'discharge', value: this.discharge });
  }

  /** Restart the sim, either pre-filled or dry. */
  reset(prefill: boolean) {
    this.restart({ prefill });
  }

  /** Restart the sim from the current terrain, optionally with saved water and discharge. */
  restart({ prefill, depth, time, discharge }: { prefill: boolean; depth?: Float32Array; time?: number; discharge?: number }) {
    this.worker.terminate();
    this.grid = null;
    this.stats = null;
    this.spare = null;
    this.inFlight = false;
    this.snapshots.clear();
    if (discharge !== undefined) this.discharge = discharge;
    this.options.prefill = prefill;
    this.options.depth = depth;
    this.options.time = time;
    this.worker = this.start();
  }

  dispose() {
    this.worker.terminate();
    this.texture?.dispose();
  }
}
