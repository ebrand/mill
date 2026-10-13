// Prime movers and the drivetrain, kept abstract (see design.md: no gear-level simulation).
// Numbers marked "estimate" are placeholders to check against period sources.

import { G } from '../water/shallowWater';

export const WATER_DENSITY = 1000;
export const WATTS_PER_HP = 745.7;
export const CFS_PER_M3S = 35.3147;
export const FT_PER_M = 3.28084;

export interface WheelSpec {
  kind: 'breastshot';
  diameter: number;
  width: number;
  /** Head range the wheel is built for, m. */
  designHead: [number, number];
  /** Efficiency inside the design range (estimate: breastshot 0.45-0.65). */
  peakEfficiency: number;
  /** What the buckets can take before they spill, m^3/s. */
  maxDischarge: number;
}

export const BREASTSHOT: WheelSpec = {
  kind: 'breastshot',
  diameter: 4.8,
  width: 2.2,
  designHead: [2.0, 4.0],
  peakEfficiency: 0.6,
  maxDischarge: 2.5,
};

/**
 * Efficiency at a given head: the peak within the design range, falling linearly to zero
 * at half the range's width beyond it (too little head and the wheel barely turns; too
 * much and the water is wasted over or past it).
 */
export function wheelEfficiency(spec: WheelSpec, head: number): number {
  const [lo, hi] = spec.designHead;
  const margin = (hi - lo) / 2;
  if (head >= lo && head <= hi) return spec.peakEfficiency;
  const off = head < lo ? lo - head : head - hi;
  return Math.max(0, spec.peakEfficiency * (1 - off / margin));
}

/** Shaft power from water passing the wheel, in watts. */
export function wheelPower(spec: WheelSpec, discharge: number, head: number): number {
  if (discharge <= 0 || head <= 0) return 0;
  return wheelEfficiency(spec, head) * WATER_DENSITY * G * discharge * head;
}

export interface MachineSpec {
  name: string;
  /** Power the machine needs at full speed, hp. */
  ratedHp: number;
  /** Output at full speed. */
  perHour: number;
  unit: string;
}

/** Up-and-down (sash) sawmill. Estimates: ~10 hp, ~120 board feet an hour. */
export const SASH_SAW: MachineSpec = { name: 'Sash saw', ratedHp: 10, perHour: 120, unit: 'board feet' };

/** Fraction of wheel power lost in the pit gear, shafting and belts (estimate). */
export const DRIVE_LOSS = 0.12;

export interface MillRun {
  wheelHp: number;
  deliveredHp: number;
  /** 0..1: machines slow in proportion when there isn't enough power. */
  speed: number;
  /** Output rate at this speed, per hour. */
  perHour: number;
  /** Power available beyond what the machines can use, hp. */
  spareHp: number;
}

export function runMill(wheelWatts: number, machine: MachineSpec): MillRun {
  const wheelHp = wheelWatts / WATTS_PER_HP;
  const deliveredHp = wheelHp * (1 - DRIVE_LOSS);
  const speed = machine.ratedHp > 0 ? Math.min(1, deliveredHp / machine.ratedHp) : 0;
  return {
    wheelHp,
    deliveredHp,
    speed,
    perHour: machine.perHour * speed,
    spareHp: Math.max(0, deliveredHp - machine.ratedHp),
  };
}

/** Discharge the wheel needs to drive a machine at full speed with a given head, m^3/s. */
export function dischargeFor(spec: WheelSpec, machine: MachineSpec, head: number): number {
  const eff = wheelEfficiency(spec, head);
  if (eff <= 0 || head <= 0) return Infinity;
  return (machine.ratedHp * WATTS_PER_HP) / (1 - DRIVE_LOSS) / (eff * WATER_DENSITY * G * head);
}
