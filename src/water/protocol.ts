import type { Link } from './shallowWater';

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

export interface LinkStats {
  id: string;
  discharge: number;
  etaFrom: number;
  etaTo: number;
}

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
  links: LinkStats[];
}

export interface BedRect {
  i0: number;
  j0: number;
  i1: number;
  j1: number;
}

export type ToWorker =
  | {
      type: 'init';
      prefill: boolean;
      discharge: number;
      grid: GridInfo;
      heights: Float32Array;
      /** Saved water depths to start from (overrides prefill), and the sim time they were at. */
      depth?: Float32Array;
      time?: number;
    }
  /** Ask for the current water depths, e.g. to save the game. */
  | { type: 'snapshot'; id: number }
  /** New terrain heights for a rectangle of cells (row-major, (i1 - i0) wide). */
  | { type: 'bed'; rect: BedRect; heights: Float32Array }
  | { type: 'step'; seconds: number; buffer: ArrayBuffer }
  | { type: 'discharge'; value: number }
  /** Add or replace a structure link (gate opening changes go through here too). */
  | { type: 'link'; link: Link };

export type FromWorker =
  | { type: 'ready'; grid: GridInfo; bed: Float32Array }
  | { type: 'state'; buffer: ArrayBuffer; stats: SimStats }
  | { type: 'snapshot'; id: number; depth: Float32Array; time: number }
  | { type: 'error'; message: string };
