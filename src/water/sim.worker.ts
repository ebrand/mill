/// <reference lib="webworker" />
// Runs the river sim off the main thread. See protocol.ts for the message flow.

import { DAM_X, riverCenter } from '../scene/site';
import type { FromWorker, SimStats, ToWorker } from './protocol';
import { STATE_STRIDE } from './protocol';
import { buildRiverSim } from './riverSim';
import type { ShallowWater } from './shallowWater';

declare const self: DedicatedWorkerGlobalScope;

let sim: ShallowWater | null = null;
const vel = { u: 0, w: 0 };

function post(msg: FromWorker, transfer: Transferable[] = []) {
  self.postMessage(msg, transfer);
}

function pack(out: Float32Array) {
  const s = sim!;
  const { nx, nz, bed, depth } = s;
  const WET = 0.005;
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const c = j * nx + i;
      const o = c * STATE_STRIDE;
      const d = depth[c];
      if (d > WET) {
        s.velocity(i, j, vel);
        out[o] = bed[c] + d;
        out[o + 1] = d;
        out[o + 2] = vel.u;
        out[o + 3] = vel.w;
        continue;
      }
      // Dry: borrow the highest wet neighbour's surface so the water mesh runs flat into
      // the bank (the terrain hides the rest). No wet neighbour: mark as far-dry.
      let eta = -Infinity;
      if (i > 0 && depth[c - 1] > WET) eta = Math.max(eta, bed[c - 1] + depth[c - 1]);
      if (i < nx - 1 && depth[c + 1] > WET) eta = Math.max(eta, bed[c + 1] + depth[c + 1]);
      if (j > 0 && depth[c - nx] > WET) eta = Math.max(eta, bed[c - nx] + depth[c - nx]);
      if (j < nz - 1 && depth[c + nx] > WET) eta = Math.max(eta, bed[c + nx] + depth[c + nx]);
      out[o] = eta > -Infinity ? eta : bed[c];
      out[o + 1] = eta > -Infinity ? 0 : -1;
      out[o + 2] = 0;
      out[o + 3] = 0;
    }
  }
}

function pondLevel(): number {
  const s = sim!;
  const i = Math.floor((DAM_X - 4 - s.x0) / s.dx);
  const j = Math.floor((riverCenter(DAM_X - 4) - s.z0) / s.dx);
  const c = j * s.nx + i;
  return s.bed[c] + s.depth[c];
}

self.onmessage = (e: MessageEvent<ToWorker>) => {
  try {
    const msg = e.data;
    if (msg.type === 'init') {
      sim = buildRiverSim({ dx: msg.dx, prefill: msg.prefill, discharge: msg.discharge });
      post({
        type: 'ready',
        grid: { nx: sim.nx, nz: sim.nz, dx: sim.dx, x0: sim.x0, z0: sim.z0 },
        bed: Float32Array.from(sim.bed),
      });
      return;
    }
    if (!sim) throw new Error('worker not initialised');
    if (msg.type === 'discharge') {
      if (sim.inflow) sim.inflow.discharge = msg.value;
      return;
    }
    if (msg.type === 'step') {
      const t0 = performance.now();
      // Cap the work per request so a long stall can't freeze the worker for seconds.
      const steps = sim.advance(Math.min(msg.seconds, 120));
      const stepMs = performance.now() - t0;
      const out = new Float32Array(msg.buffer);
      pack(out);
      const stats: SimStats = {
        time: sim.time,
        volume: sim.totalVolume(),
        inflow: sim.inflow?.discharge ?? 0,
        outflow: sim.lastOutflow,
        spill: sim.lastWeirFlow,
        pondLevel: pondLevel(),
        steps,
        stepMs,
      };
      post({ type: 'state', buffer: msg.buffer, stats }, [msg.buffer]);
    }
  } catch (err) {
    post({ type: 'error', message: String(err instanceof Error ? err.stack ?? err.message : err) });
  }
};
