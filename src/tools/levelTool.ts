// The surveyor's level: sight between two points and read the difference in height. Water
// reads as its surface (that's what a surveyor would hold the staff on). Readings can be
// kept in a field book, which is how a race line was run out along the contour.

import type { WaterClient } from '../water/WaterClient';
import type { TerrainField } from '../world/terrainField';
import type { PathSource } from './pathView';

export interface LevelShot {
  /** Elevation at each end, m. */
  a: number;
  b: number;
  aWater: boolean;
  bWater: boolean;
  /** Horizontal distance, m. */
  distance: number;
  /** b minus a, m (negative = b is lower). */
  rise: number;
}

export interface FieldBookEntry extends LevelShot {
  n: number;
  from: { x: number; z: number };
  to: { x: number; z: number };
}

export interface LevelSnapshot {
  points: number;
  shot: LevelShot | null;
  book: FieldBookEntry[];
}

export class LevelController implements PathSource {
  points: { x: number; z: number }[] = [];
  env: { field: TerrainField; water: () => WaterClient | null } | null = null;
  private book: FieldBookEntry[] = [];
  private snapshot: LevelSnapshot = { points: 0, shot: null, book: [] };
  private listeners = new Set<() => void>();
  private dirty = false;
  private lastCompute = 0;

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getSnapshot = () => this.snapshot;

  addPoint(x: number, z: number) {
    // Two points; a third click starts a new sight from the last point (running a line).
    if (this.points.length < 2) this.points.push({ x, z });
    else this.points = [this.points[1], { x, z }];
    this.dirty = true;
  }
  movePoint(index: number, x: number, z: number) {
    this.points[index] = { x, z };
    this.dirty = true;
  }
  removeLast() {
    this.points.pop();
    this.dirty = true;
  }
  clear() {
    this.points = [];
    this.dirty = true;
  }

  /** Commit = write the current sight into the field book. */
  commit(): FieldBookEntry | null {
    const shot = this.snapshot.shot;
    if (!shot || this.points.length < 2) return null;
    const entry: FieldBookEntry = { ...shot, n: this.book.length + 1, from: { ...this.points[0] }, to: { ...this.points[1] } };
    this.book = [...this.book, entry];
    this.publishBook();
    return entry;
  }

  clearBook() {
    this.book = [];
    this.publishBook();
  }

  /** The field book shows at once, without waiting for the next frame. */
  private publishBook() {
    this.snapshot = { ...this.snapshot, book: this.book };
    for (const fn of this.listeners) fn();
  }

  /** Elevation a staff would read at a point: the water surface if wet, else the ground. */
  reading(x: number, z: number): { level: number; water: boolean } {
    const w = this.env?.water()?.surfaceAt(x, z);
    if (w && w.depth > 0.05) return { level: w.eta, water: true };
    return { level: this.env!.field.heightAt(x, z), water: false };
  }

  update(now: number) {
    // Water moves, so refresh a standing sight a few times a second even without edits.
    if (!this.dirty && (this.points.length < 2 || now - this.lastCompute < 300)) return;
    this.dirty = false;
    this.lastCompute = now;
    let shot: LevelShot | null = null;
    if (this.env && this.points.length === 2) {
      const [p, q] = this.points;
      const a = this.reading(p.x, p.z);
      const b = this.reading(q.x, q.z);
      shot = { a: a.level, b: b.level, aWater: a.water, bWater: b.water, distance: Math.hypot(q.x - p.x, q.z - p.z), rise: b.level - a.level };
    }
    this.snapshot = { points: this.points.length, shot, book: this.book };
    for (const fn of this.listeners) fn();
  }

  /** The line of sight, drawn dashed a little above the staff points. */
  previewLines(): [number, number, number][][] {
    if (!this.env || this.points.length < 2) return [];
    const [p, q] = this.points;
    const a = this.reading(p.x, p.z).level + 1.5;
    const b = this.reading(q.x, q.z).level + 1.5;
    // Staffs at each end plus the sight between them.
    return [
      [[p.x, a - 1.5, p.z], [p.x, a, p.z]],
      [[q.x, b - 1.5, q.z], [q.x, b, q.z]],
      [[p.x, a, p.z], [q.x, b, q.z]],
    ];
  }
}

/** Feet and inches, the way a period surveyor would write it. */
export function feetInches(m: number): string {
  const sign = m < 0 ? '−' : '';
  const totalIn = Math.round(Math.abs(m) * 39.3701);
  const ft = Math.floor(totalIn / 12);
  const inch = totalIn % 12;
  return `${sign}${ft} ft ${inch} in`;
}

/** Fall per distance as "1 in N" (or "level"). */
export function gradient(rise: number, distance: number): string {
  if (Math.abs(rise) < 1e-3 || distance <= 0) return 'level';
  return `1 in ${Math.round(distance / Math.abs(rise)).toLocaleString()} ${rise < 0 ? 'fall' : 'rise'}`;
}
