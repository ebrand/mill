// Placed hydraulic structures: head gates (sluices) and wheels. Each is a link in the water
// sim between an intake point and an outlet point (see shallowWater.ts Link), so a gate can
// pass water through a dam or bank, and a wheel turns the fall between a headrace and its
// tailrace into power.

import type { GridInfo } from '../water/protocol';
import type { Link } from '../water/shallowWater';
import { BREASTSHOT } from './wheel';

export type StructureKind = 'gate' | 'wheel';

export interface Structure {
  id: string;
  kind: StructureKind;
  name: string;
  /** Intake (upstream) and outlet (downstream) points, world XZ. */
  intake: { x: number; z: number };
  outlet: { x: number; z: number };
  /** Gate width, m. */
  width: number;
  /** Gate sill elevation, m. */
  sill: number;
  /** Gate opening, m. */
  opening: number;
  /** Largest opening the gate allows, m. */
  maxOpening: number;
  /** Board feet cut so far (wheels drive a saw). */
  lumber: number;
  /** Drawn by the site itself (the original mill), not by the structure renderer. */
  builtIn?: boolean;
  /**
   * The wheel pit dug when it was built: it starts `start` m past the intake (leaving a
   * breast of earth between race and pit) and runs to the outlet, floored at `floor`.
   */
  pit?: { start: number; floor: number; radius: number };
  /**
   * Explicit intake/outlet areas [x0, x1, z0, z1] instead of disks around the points; used
   * by the built-in mill, whose intake and pit are rectangular.
   */
  areas?: { intake: [number, number, number, number]; outlet: [number, number, number, number] };
}

/** Head lost in the flume or race and at the gate before the wheel, m (estimate). */
export const WHEEL_ENTRY_LOSS = 0.1;

export function cellsInDisk(grid: GridInfo, x: number, z: number, radius: number): number[] {
  const out: number[] = [];
  const r2 = radius * radius;
  const i0 = Math.max(0, Math.floor((x - radius - grid.x0) / grid.dx));
  const i1 = Math.min(grid.nx - 1, Math.ceil((x + radius - grid.x0) / grid.dx));
  const j0 = Math.max(0, Math.floor((z - radius - grid.z0) / grid.dx));
  const j1 = Math.min(grid.nz - 1, Math.ceil((z + radius - grid.z0) / grid.dx));
  for (let j = j0; j <= j1; j++) {
    const cz = grid.z0 + (j + 0.5) * grid.dx - z;
    for (let i = i0; i <= i1; i++) {
      const cx = grid.x0 + (i + 0.5) * grid.dx - x;
      if (cx * cx + cz * cz <= r2) out.push(j * grid.nx + i);
    }
  }
  // Always at least the cell containing the point.
  if (out.length === 0) {
    const i = Math.min(grid.nx - 1, Math.max(0, Math.floor((x - grid.x0) / grid.dx)));
    const j = Math.min(grid.nz - 1, Math.max(0, Math.floor((z - grid.z0) / grid.dx)));
    out.push(j * grid.nx + i);
  }
  return out;
}

function cellsInBox(grid: GridInfo, [x0, x1, z0, z1]: [number, number, number, number]): number[] {
  const out: number[] = [];
  for (let j = 0; j < grid.nz; j++) {
    const z = grid.z0 + (j + 0.5) * grid.dx;
    if (z < z0 || z > z1) continue;
    for (let i = 0; i < grid.nx; i++) {
      const x = grid.x0 + (i + 0.5) * grid.dx;
      if (x >= x0 && x <= x1) out.push(j * grid.nx + i);
    }
  }
  return out;
}

/** The sim link for a structure. */
export function structureLink(grid: GridInfo, s: Structure): Link {
  const r = Math.max(1, s.width / 2);
  return {
    id: s.id,
    from: s.areas ? cellsInBox(grid, s.areas.intake) : cellsInDisk(grid, s.intake.x, s.intake.z, r),
    to: s.areas ? cellsInBox(grid, s.areas.outlet) : cellsInDisk(grid, s.outlet.x, s.outlet.z, r),
    sill: s.sill,
    width: s.width,
    opening: Math.max(0, Math.min(s.maxOpening, s.opening)),
    // A wheel's buckets limit what it can take; a plain gate is limited only by its opening.
    maxDischarge: s.kind === 'wheel' ? BREASTSHOT.maxDischarge : Infinity,
  };
}

/** Earth left between the end of the race and the start of the wheel pit, m. */
export const BREAST = 3.5;

/**
 * Size a breastshot wheel for a site: water arrives about axle height off the race floor
 * (the sill), the top clears the race water, the bottom dips into the tailrace.
 */
export function wheelGeometry(sill: number, outletGround: number): { radius: number; floor: number } {
  const top = sill + 1.8;
  const bottom = Math.min(outletGround, sill) - 0.2;
  const radius = Math.min(3.2, Math.max(1.2, (top - bottom) / 2));
  return { radius, floor: top - 2 * radius - 0.3 };
}

/** Pit length a wheel needs past the breast, m. */
export function pitLength(radius: number): number {
  return 2 * radius + 1;
}

/** Fall available to a wheel from the link's water levels, m. */
export function wheelHead(etaFrom: number, etaTo: number): number {
  return Math.max(0, etaFrom - etaTo - WHEEL_ENTRY_LOSS);
}

let counter = 0;
export function newStructureId(kind: StructureKind): string {
  counter++;
  return `${kind}-${Date.now().toString(36)}-${counter}`;
}
