import { BufferAttribute, BufferGeometry, type Camera, Group, Line, Raycaster, Vector2, Vector3 } from 'three';
import { attribute, Discard, Fn, fract, vec4 } from 'three/tsl';
import { LineBasicNodeMaterial } from 'three/webgpu';
import { isTyping } from '../debug/devExpose';
import type { WaterClient } from '../water/WaterClient';
import type { TerrainField } from '../world/terrainField';
import type { Centerline } from './channel';

/** What a path tool (channel, bank) exposes to the shared view. */
export interface PathSource {
  points: { x: number; z: number }[];
  env: { field: TerrainField; water: () => WaterClient | null } | null;
  addPoint(x: number, z: number): void;
  movePoint(index: number, x: number, z: number): void;
  removeLast(): void;
  commit(): unknown;
  /** Polylines to draw dashed in the scene, in world coordinates. */
  previewLines(): [number, number, number][][];
}

/** Unit normal (to the left of the direction of travel) at vertex k of a centerline. */
export function normalAt(line: Centerline, k: number): [number, number] {
  const a = Math.max(0, k - 1);
  const b = Math.min(line.x.length - 1, k + 1);
  const dx = line.x[b] - line.x[a];
  const dz = line.z[b] - line.z[a];
  const len = Math.hypot(dx, dz) || 1;
  return [-dz / len, dx / len];
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

export function polyline(n: number, dashed: boolean): Line {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(n * 3), 3));
  g.setAttribute('lineDistance', new BufferAttribute(new Float32Array(n), 1));
  const line = new Line(g, inkLine(dashed));
  line.frustumCulled = false;
  return line;
}

export function setPolyline(line: Line, pts: [number, number, number][]) {
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

/** Draws a planned path (channel, bank, ...) and handles clicking and dragging its control points. */
export class PathView {
  readonly group = new Group();
  active = false;

  /** Pool of dashed preview lines, grown as a source asks for more. */
  private readonly lines: Line[] = [];
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
    private readonly controller: PathSource,
    private readonly field: TerrainField,
    private readonly dom: HTMLElement,
    private readonly camera: () => Camera,
  ) {
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
    const preview = c.previewLines();
    while (this.lines.length < preview.length) {
      const line = polyline(512, true);
      this.lines.push(line);
      this.group.add(line);
    }
    this.lines.forEach((line, k) => {
      line.visible = k < preview.length && preview[k].length > 1;
      if (line.visible) setPolyline(line, preview[k]);
    });
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
