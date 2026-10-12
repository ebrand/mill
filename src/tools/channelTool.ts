import type { WaterClient } from '../water/WaterClient';
import type { TerrainField } from '../world/terrainField';
import {
  applyChannel,
  bedAt,
  type ChannelPlan,
  type ChannelResult,
  DEFAULT_PLAN,
  manningCapacity,
  nearest,
  planChannel,
  shapeGround,
} from './channel';
import { normalAt, type PathSource } from './pathView';

export type ChannelParams = Omit<ChannelPlan, 'points' | 'startBed'>;

export interface ChannelSection {
  /** Offsets across the channel, m (negative = left of the direction of flow). */
  offsets: number[];
  before: number[];
  after: number[];
  water: number;
}

export interface ChannelSummary {
  points: number;
  params: ChannelParams;
  length: number;
  fall: number;
  /** Water level the channel starts from (the pond if the first point is in it). */
  startLevel: number | null;
  startsInWater: boolean;
  /** Design discharge at the design depth, m^3/s. */
  capacity: number;
  cut: number;
  fill: number;
  /** Design water level at the end minus the lowest river water nearby. */
  headAtEnd: number | null;
  section: ChannelSection | null;
}

export interface ChannelEnv {
  field: TerrainField;
  water: () => WaterClient | null;
  /** Called after the field has been changed by a committed channel. */
  onCommit: (result: ChannelResult) => void;
}

/** The channel being planned: control points, parameters, and the computed preview. */
export class ChannelController implements PathSource {
  points: { x: number; z: number }[] = [];
  params: ChannelParams = { ...DEFAULT_PLAN };
  env: ChannelEnv | null = null;
  result: ChannelResult | null = null;
  plan: ChannelPlan | null = null;

  private summary: ChannelSummary = this.emptySummary();
  private listeners = new Set<() => void>();
  private dirty = false;
  private lastCompute = 0;

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getSnapshot = () => this.summary;

  private emptySummary(): ChannelSummary {
    return { points: 0, params: { ...this.params }, length: 0, fall: 0, startLevel: null, startsInWater: false, capacity: 0, cut: 0, fill: 0, headAtEnd: null, section: null };
  }

  private changed() {
    this.dirty = true;
  }

  addPoint(x: number, z: number) {
    this.points.push({ x, z });
    this.changed();
  }
  movePoint(index: number, x: number, z: number) {
    this.points[index] = { x, z };
    this.changed();
  }
  removeLast() {
    this.points.pop();
    this.changed();
  }
  clear() {
    this.points = [];
    this.changed();
  }
  setParam<K extends keyof ChannelParams>(key: K, value: ChannelParams[K]) {
    this.params = { ...this.params, [key]: value };
    this.changed();
  }

  /** Recompute the preview if something changed (at most ~10 times a second). */
  update(now: number) {
    if (!this.dirty || now - this.lastCompute < 100) return false;
    this.dirty = false;
    this.lastCompute = now;
    this.recompute();
    return true;
  }

  private recompute() {
    const env = this.env;
    if (!env || this.points.length < 2) {
      this.result = null;
      this.plan = null;
      this.summary = { ...this.emptySummary(), points: this.points.length };
      this.emit();
      return;
    }
    const { field } = env;
    const water = env.water();
    const p0 = this.points[0];
    const w0 = water?.surfaceAt(p0.x, p0.z);
    const startsInWater = !!w0 && w0.depth > 0.05;
    const startLevel = startsInWater ? w0!.eta : field.heightAt(p0.x, p0.z);
    const plan: ChannelPlan = { ...this.params, points: this.points, startBed: startLevel - this.params.depth };
    const result = planChannel(field, plan);
    const end = this.points[this.points.length - 1];
    const tail = water?.lowestWaterNear(end.x, end.z, 20) ?? null;
    const endLevel = bedAt(plan, result.line.length) + plan.depth;
    this.plan = plan;
    this.result = result;
    this.summary = {
      points: this.points.length,
      params: { ...this.params },
      length: result.line.length,
      fall: result.fall,
      startLevel,
      startsInWater,
      capacity: manningCapacity(plan.bottomWidth, plan.sideSlope, plan.depth, plan.bedSlope),
      cut: result.cut,
      fill: result.fill,
      headAtEnd: tail === null ? null : endLevel - tail,
      section: this.sectionAt(plan, result, result.line.length / 2),
    };
    this.emit();
  }

  /** Cross-section through the channel at arc length s, before and after the works. */
  private sectionAt(plan: ChannelPlan, result: ChannelResult, s: number): ChannelSection {
    const { line } = result;
    const field = this.env!.field;
    let k = 0;
    while (k < line.s.length - 2 && line.s[k + 1] < s) k++;
    const dx = line.x[k + 1] - line.x[k];
    const dz = line.z[k + 1] - line.z[k];
    const len = Math.hypot(dx, dz) || 1;
    const t = (s - line.s[k]) / ((line.s[k + 1] - line.s[k]) || 1);
    const cx = line.x[k] + dx * t;
    const cz = line.z[k] + dz * t;
    // Left normal of the direction of flow.
    const nx = -dz / len;
    const nz = dx / len;
    const half = plan.bottomWidth / 2 + (plan.depth + plan.freeboard) * plan.sideSlope + plan.crestWidth + 6;
    const offsets: number[] = [];
    const before: number[] = [];
    const after: number[] = [];
    const bed = bedAt(plan, s);
    for (let o = -half; o <= half + 1e-9; o += field.dx / 2) {
      const x = cx - nx * o;
      const z = cz - nz * o;
      const ground = field.heightAt(x, z);
      const d = nearest(line, x, z).d;
      offsets.push(o);
      before.push(ground);
      after.push(shapeGround(plan, bed, d, ground));
    }
    return { offsets, before, after, water: bed + plan.depth };
  }

  /** Dig it: write the preview into the terrain and hand it to the scene. */
  commit() {
    if (!this.env || !this.result) return null;
    applyChannel(this.env.field, this.result);
    const result = this.result;
    this.env.onCommit(result);
    this.clear();
    this.recompute();
    return result;
  }

  /** Dashed lines for the scene: the design water line and the top-of-water edges. */
  previewLines(): [number, number, number][][] {
    const plan = this.plan;
    const result = this.result;
    const field = this.env?.field;
    if (!plan || !result || !field) return [];
    const { line } = result;
    const edge = plan.bottomWidth / 2 + plan.depth * plan.sideSlope;
    const water: [number, number, number][] = [];
    const left: [number, number, number][] = [];
    const right: [number, number, number][] = [];
    const step = Math.max(1, Math.floor(line.x.length / 400));
    for (let k = 0; k < line.x.length; k += step) {
      const level = bedAt(plan, line.s[k]) + plan.depth;
      const [nx, nz] = normalAt(line, k);
      water.push([line.x[k], level + 0.05, line.z[k]]);
      // Top-of-water edges, lifted onto the ground where the ground is higher.
      for (const [list, sign] of [[left, 1], [right, -1]] as const) {
        const x = line.x[k] + nx * edge * sign;
        const z = line.z[k] + nz * edge * sign;
        list.push([x, Math.max(level, field.heightAt(x, z)) + 0.08, z]);
      }
    }
    return [water, left, right];
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }
}
