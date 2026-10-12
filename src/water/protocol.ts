// Messages between the main thread and the water worker. State buffers are transferred
// (zero-copy) back and forth: the main thread always hands one back before asking again,
// so there's never more than one request in flight and no shared memory (which would need
// COOP/COEP headers on every host).

export interface GridInfo {
  nx: number;
  nz: number;
  dx: number;
  x0: number;
  z0: number;
}

/** Per-cell layout of the packed state buffer (Float32, 4 values per cell). */
export const STATE_STRIDE = 4;
// [0] surface elevation (dry cells next to water borrow the neighbouring surface so the
//     mesh meets the bank cleanly), [1] depth (-1 = dry and away from water),
// [2] velocity x, [3] velocity z.

export interface SimStats {
  time: number;
  volume: number;
  inflow: number;
  outflow: number;
  /** Discharge over the spillway and abutments, m^3/s. */
  spill: number;
  /** Water level just upstream of the dam. */
  pondLevel: number;
  steps: number;
  /** Wall time the worker spent stepping for this request. */
  stepMs: number;
}

export type ToWorker =
  | { type: 'init'; dx: number; prefill: boolean; discharge: number }
  | { type: 'step'; seconds: number; buffer: ArrayBuffer }
  | { type: 'discharge'; value: number };

export type FromWorker =
  | { type: 'ready'; grid: GridInfo; bed: Float32Array }
  | { type: 'state'; buffer: ArrayBuffer; stats: SimStats }
  | { type: 'error'; message: string };
