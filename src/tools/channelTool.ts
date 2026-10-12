import { BufferAttribute, BufferGeometry, type Camera, Group, Line, Raycaster, Vector2, Vector3 } from 'three';
import { attribute, Discard, Fn, fract, vec4 } from 'three/tsl';
import { LineBasicNodeMaterial } from 'three/webgpu';
import { isTyping } from '../debug/devExpose';
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
export class ChannelController {
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

  private emit() {
    for (const fn of this.listeners) fn();
  }
}

/** Ink line material; with dashes, it draws the "proposed work" convention. */
function inkLine(dashed: boolean) {
  const m = new LineBasicNodeMaterial();
  m.outputNode = Fn(() => {
    if (dashed) Discard(fract(attribute('lineDistance', 'float').div(1.6)).greaterThan(0.55));
    return vec4(0.9, 1, 0, 0);
  })();
  return m;
}

function polyline(n: number, dashed: boolean): Line {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(n * 3), 3));
  g.setAttribute('lineDistance', new BufferAttribute(new Float32Array(n), 1));
  const line = new Line(g, inkLine(dashed));
  line.frustumCulled = false;
  return line;
}

function setPolyline(line: Line, pts: [number, number, number][]) {
  let g = line.geometry;
  if ((g.getAttribute('position') as BufferAttribute).count < pts.length) {
    g.dispose();
    const fresh = polyline(pts.length * 2, false).geometry;
    line.geometry = fresh;
    g = fresh;
  }
  const pos = g.getAttribute('position') as BufferAttribute;
  const dist = g.getAttribute('lineDistance') as BufferAttribute;
  let acc = 0;
  for (let k = 0; k < pts.length; k++) {
    if (k > 0) acc += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1], pts[k][2] - pts[k - 1][2]);
    pos.setXYZ(k, pts[k][0], pts[k][1], pts[k][2]);
    dist.setX(k, acc);
  }
  pos.needsUpdate = true;
  dist.needsUpdate = true;
  g.setDrawRange(0, pts.length);
}

/** Draws the planned channel and handles clicking and dragging its control points. */
export class ChannelView {
  readonly group = new Group();
  active = false;

  private readonly waterLine = polyline(512, true);
  private readonly leftEdge = polyline(512, true);
  private readonly rightEdge = polyline(512, true);
  /** Closed strips (first vertex repeated): WebGPU has no line-loop primitive. */
  private markers: Line[] = [];
  private readonly markerMaterial = inkLine(false);
  private readonly raycaster = new Raycaster();
  private readonly ndc = new Vector2();
  private dragging = -1;
  private readonly tmp = new Vector3();

  private readonly onDown = (e: PointerEvent) => {
    if (!this.active || e.button !== 0) return;
    const hit = this.pick(e);
    if (!hit) return;
    const near = this.markerNear(e);
    if (near >= 0) this.dragging = near;
    else this.controller.addPoint(hit[0], hit[2]);
  };
  private readonly onMove = (e: PointerEvent) => {
    if (this.dragging < 0) return;
    const hit = this.pick(e);
    if (hit) this.controller.movePoint(this.dragging, hit[0], hit[2]);
  };
  private readonly onUp = () => {
    this.dragging = -1;
  };
  private readonly onKey = (e: KeyboardEvent) => {
    if (!this.active || isTyping(e)) return;
    if (e.code === 'Backspace' || e.code === 'Delete') this.controller.removeLast();
    if (e.code === 'Enter') this.controller.commit();
  };

  constructor(
    private readonly controller: ChannelController,
    private readonly field: TerrainField,
    private readonly dom: HTMLElement,
    private readonly camera: () => Camera,
  ) {
    this.group.add(this.waterLine, this.leftEdge, this.rightEdge);
    dom.addEventListener('pointerdown', this.onDown);
    dom.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('keydown', this.onKey);
  }

  private pick(e: PointerEvent): [number, number, number] | null {
    const r = this.dom.getBoundingClientRect();
    this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera());
    const o = this.raycaster.ray.origin;
    const d = this.raycaster.ray.direction;
    return this.field.raycast([o.x, o.y, o.z], [d.x, d.y, d.z]);
  }

  /** Index of a control point within 14 px of the pointer, or -1. */
  private markerNear(e: PointerEvent): number {
    const r = this.dom.getBoundingClientRect();
    let best = -1;
    let bestD = 14;
    this.controller.points.forEach((p, k) => {
      this.tmp.set(p.x, this.field.heightAt(p.x, p.z), p.z).project(this.camera());
      const sx = r.left + ((this.tmp.x + 1) / 2) * r.width;
      const sy = r.top + ((1 - this.tmp.y) / 2) * r.height;
      const d = Math.hypot(sx - e.clientX, sy - e.clientY);
      if (d < bestD) {
        bestD = d;
        best = k;
      }
    });
    return best;
  }

  /** Redraw markers and the proposal; call each frame. */
  update() {
    const c = this.controller;
    const show = this.active || c.points.length > 0;
    this.group.visible = show;
    if (!show) return;
    this.syncMarkers();
    const plan = c.plan;
    const result = c.result;
    if (!plan || !result) {
      this.waterLine.visible = this.leftEdge.visible = this.rightEdge.visible = false;
      return;
    }
    this.waterLine.visible = this.leftEdge.visible = this.rightEdge.visible = true;
    const { line } = result;
    const edge = plan.bottomWidth / 2 + plan.depth * plan.sideSlope;
    const water: [number, number, number][] = [];
    const left: [number, number, number][] = [];
    const right: [number, number, number][] = [];
    const step = Math.max(1, Math.floor(line.x.length / 400));
    for (let k = 0; k < line.x.length; k += step) {
      const level = bedAt(plan, line.s[k]) + plan.depth;
      const a = Math.max(0, k - 1);
      const b = Math.min(line.x.length - 1, k + 1);
      const dx = line.x[b] - line.x[a];
      const dz = line.z[b] - line.z[a];
      const len = Math.hypot(dx, dz) || 1;
      const nx = -dz / len;
      const nz = dx / len;
      water.push([line.x[k], level + 0.05, line.z[k]]);
      // Top-of-water edges, lifted onto the ground where the ground is higher.
      for (const [list, sign] of [[left, 1], [right, -1]] as const) {
        const x = line.x[k] + nx * edge * sign;
        const z = line.z[k] + nz * edge * sign;
        list.push([x, Math.max(level, this.field.heightAt(x, z)) + 0.08, z]);
      }
    }
    setPolyline(this.waterLine, water);
    setPolyline(this.leftEdge, left);
    setPolyline(this.rightEdge, right);
  }

  private syncMarkers() {
    const pts = this.controller.points;
    while (this.markers.length < pts.length) {
      const g = new BufferGeometry();
      g.setAttribute('position', new BufferAttribute(new Float32Array(5 * 3), 3));
      const m = new Line(g, this.markerMaterial);
      m.frustumCulled = false;
      this.markers.push(m);
      this.group.add(m);
    }
    this.markers.forEach((m, k) => {
      m.visible = k < pts.length;
      if (!m.visible) return;
      const p = pts[k];
      const s = 0.6;
      const pos = m.geometry.getAttribute('position') as BufferAttribute;
      const corners = [[-s, -s], [s, -s], [s, s], [-s, s], [-s, -s]];
      // Sit on the ground, or on the water where the point is in it (else the water hides it).
      const w = this.controller.env?.water()?.surfaceAt(p.x, p.z);
      const water = w && w.depth > 0.02 ? w.eta : -Infinity;
      corners.forEach(([ox, oz], v) =>
        pos.setXYZ(v, p.x + ox, Math.max(this.field.heightAt(p.x + ox, p.z + oz), water) + 0.1, p.z + oz),
      );
      pos.needsUpdate = true;
    });
  }

  dispose() {
    this.dom.removeEventListener('pointerdown', this.onDown);
    this.dom.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    window.removeEventListener('keydown', this.onKey);
  }
}
