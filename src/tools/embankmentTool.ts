import type { WaterClient } from '../water/WaterClient';
import type { Rect, TerrainField } from '../world/terrainField';
import { nearest, writeHeights } from './channel';
import type { ChannelSection } from './channelTool';
import { DEFAULT_EMBANKMENT, type EmbankmentPlan, type EmbankmentResult, planEmbankment, shapeBank } from './embankment';
import { normalAt, type PathSource } from './pathView';

export interface EmbankmentParams {
  crestWidth: number;
  sideSlope: number;
  /** Crest elevation, m. Null until the first point is placed, then suggested from it. */
  crest: number | null;
}

export interface EmbankmentSummary {
  points: number;
  params: EmbankmentParams;
  length: number;
  fill: number;
  maxHeight: number;
  /** Water level at the first point, if it's in water. */
  waterLevel: number | null;
  /** Ground at each end of the bank; below the crest, water can go around it. */
  endGround: [number, number] | null;
  section: ChannelSection | null;
}

export interface EmbankmentEnv {
  field: TerrainField;
  water: () => WaterClient | null;
  /** Called just before a committed bank changes the field (for undo). */
  beforeCommit: (rect: Rect, label: string) => void;
  onCommit: (result: EmbankmentResult) => void;
}

/** Height of a suggested crest above the water (or ground) at the first point. */
const SUGGESTED_FREEBOARD = 1.0;

/** The bank being planned. Mirrors ChannelController. */
export class EmbankmentController implements PathSource {
  points: { x: number; z: number }[] = [];
  params: EmbankmentParams = { ...DEFAULT_EMBANKMENT, crest: null };
  env: EmbankmentEnv | null = null;
  result: EmbankmentResult | null = null;
  plan: EmbankmentPlan | null = null;

  private summary: EmbankmentSummary = this.empty();
  private listeners = new Set<() => void>();
  private dirty = false;
  private lastCompute = 0;

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getSnapshot = () => this.summary;

  private empty(): EmbankmentSummary {
    return { points: this.points.length, params: { ...this.params }, length: 0, fill: 0, maxHeight: 0, waterLevel: null, endGround: null, section: null };
  }

  private waterAt(x: number, z: number): number | null {
    const w = this.env?.water()?.surfaceAt(x, z);
    return w && w.depth > 0.05 ? w.eta : null;
  }

  addPoint(x: number, z: number) {
    this.points.push({ x, z });
    if (this.params.crest === null && this.env) {
      // Suggest a crest a metre above the water (or ground) where the bank starts.
      const base = this.waterAt(x, z) ?? this.env.field.heightAt(x, z);
      this.params = { ...this.params, crest: Math.round((base + SUGGESTED_FREEBOARD) * 10) / 10 };
    }
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
    this.params = { ...this.params, crest: null };
    this.dirty = true;
  }
  setParam<K extends keyof EmbankmentParams>(key: K, value: EmbankmentParams[K]) {
    this.params = { ...this.params, [key]: value };
    this.dirty = true;
  }

  update(now: number) {
    if (!this.dirty || now - this.lastCompute < 100) return false;
    this.dirty = false;
    this.lastCompute = now;
    this.recompute();
    return true;
  }

  private recompute() {
    if (!this.env || this.points.length < 2 || this.params.crest === null) {
      this.result = null;
      this.plan = null;
      this.summary = this.empty();
      this.emit();
      return;
    }
    const plan: EmbankmentPlan = {
      points: this.points,
      crest: this.params.crest,
      crestWidth: this.params.crestWidth,
      sideSlope: this.params.sideSlope,
    };
    const result = planEmbankment(this.env.field, plan);
    this.plan = plan;
    this.result = result;
    this.summary = {
      points: this.points.length,
      params: { ...this.params },
      length: result.line.length,
      fill: result.fill,
      maxHeight: result.maxHeight,
      waterLevel: this.waterAt(this.points[0].x, this.points[0].z),
      endGround: [
        this.env.field.heightAt(this.points[0].x, this.points[0].z),
        this.env.field.heightAt(this.points[this.points.length - 1].x, this.points[this.points.length - 1].z),
      ],
      section: this.section(plan, result),
    };
    this.emit();
  }

  /** Section across the bank where it stands tallest. */
  private section(plan: EmbankmentPlan, result: EmbankmentResult): ChannelSection {
    const field = this.env!.field;
    const { line } = result;
    let k = 0;
    let lowest = Infinity;
    for (let i = 0; i < line.x.length; i++) {
      const g = field.heightAt(line.x[i], line.z[i]);
      if (g < lowest) {
        lowest = g;
        k = i;
      }
    }
    const [nx, nz] = normalAt(line, k);
    const half = plan.crestWidth / 2 + result.maxHeight * plan.sideSlope + 4;
    const offsets: number[] = [];
    const before: number[] = [];
    const after: number[] = [];
    for (let o = -half; o <= half + 1e-9; o += field.dx / 2) {
      const x = line.x[k] - nx * o;
      const z = line.z[k] - nz * o;
      const ground = field.heightAt(x, z);
      offsets.push(o);
      before.push(ground);
      after.push(shapeBank(plan, nearest(line, x, z).d, ground));
    }
    const water = this.summary.waterLevel ?? this.waterAt(line.x[k], line.z[k]) ?? -Infinity;
    return { offsets, before, after, water };
  }

  /** Hand the current plan over (e.g. to the works plan) and start afresh. */
  take(): EmbankmentPlan | null {
    const plan = this.plan ? { ...this.plan, points: this.plan.points.map((p) => ({ ...p })) } : null;
    if (plan) {
      this.clear();
      this.recompute();
    }
    return plan;
  }

  commit() {
    if (!this.env || !this.result) return null;
    this.env.beforeCommit(this.result.rect, 'bank');
    writeHeights(this.env.field, this.result.rect, this.result.heights);
    const result = this.result;
    this.env.onCommit(result);
    this.clear();
    this.recompute();
    return result;
  }

  /** Dashed crest edges, at crest height or on the ground where it's higher. */
  previewLines(): [number, number, number][][] {
    const plan = this.plan;
    const result = this.result;
    const field = this.env?.field;
    if (!plan || !result || !field) return [];
    const { line } = result;
    const left: [number, number, number][] = [];
    const right: [number, number, number][] = [];
    const half = plan.crestWidth / 2;
    const step = Math.max(1, Math.floor(line.x.length / 400));
    for (let k = 0; k < line.x.length; k += step) {
      const [nx, nz] = normalAt(line, k);
      for (const [list, sign] of [[left, 1], [right, -1]] as const) {
        const x = line.x[k] + nx * half * sign;
        const z = line.z[k] + nz * half * sign;
        list.push([x, Math.max(plan.crest, field.heightAt(x, z)) + 0.08, z]);
      }
    }
    return [left, right];
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }
}
