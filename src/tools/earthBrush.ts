import { BufferAttribute, BufferGeometry, type Camera, Line, Raycaster, Vector2 } from 'three';
import { vec4 } from 'three/tsl';
import { LineBasicNodeMaterial } from 'three/webgpu';
import type { EditHistory } from '../world/editHistory';
import type { Rect, TerrainField } from '../world/terrainField';
import type { TerrainMeshes } from '../world/terrainMesh';

export type Tool = 'look' | 'level' | 'dig' | 'fill' | 'channel' | 'bank' | 'gate' | 'wheel';

const RING_SEGMENTS = 64;
/** Change in ground height per second at the brush center, in meters. */
const RATE = 0.6;
export const BRUSH_RADIUS = { min: 1, max: 12, initial: 3 };

/**
 * Dig and fill: hold the left button to lower or raise the ground under the cursor. Edits
 * go to the terrain meshes immediately and to the water sim via `onBedChanged`.
 */
export class EarthBrush {
  tool: Tool = 'look';
  radius = BRUSH_RADIUS.initial;
  /** A closed strip (first vertex repeated): WebGPU has no line-loop primitive. */
  readonly ring: Line;

  private readonly ndc = new Vector2();
  private readonly raycaster = new Raycaster();
  private inside = false;
  private down = false;
  private hit: [number, number, number] | null = null;

  private readonly onMove = (e: PointerEvent) => {
    const r = this.dom.getBoundingClientRect();
    this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.inside = true;
  };
  private readonly onLeave = () => {
    this.inside = false;
    this.stopStroke();
  };
  private get working(): boolean {
    return this.tool === 'dig' || this.tool === 'fill';
  }

  // One press-to-release stroke is one undo step.
  private readonly onDown = (e: PointerEvent) => {
    if (e.button !== 0 || !this.working) return;
    this.down = true;
    this.history.begin(this.tool === 'dig' ? 'dig' : 'fill');
  };
  private readonly onUp = (e: PointerEvent) => {
    if (e.button === 0) this.stopStroke();
  };
  private stopStroke() {
    if (!this.down) return;
    this.down = false;
    this.history.end();
    this.onStrokeEnd();
  }

  constructor(
    private readonly field: TerrainField,
    private readonly terrain: TerrainMeshes,
    private readonly dom: HTMLElement,
    private readonly onBedChanged: (rect: Rect) => void,
    private readonly history: EditHistory,
    private readonly onStrokeEnd: () => void = () => {},
  ) {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array((RING_SEGMENTS + 1) * 3), 3));
    const material = new LineBasicNodeMaterial();
    // Full ink, surface id 0, no wash.
    material.outputNode = vec4(1, 1, 0, 0);
    this.ring = new Line(g, material);
    this.ring.frustumCulled = false;
    this.ring.visible = false;
    dom.addEventListener('pointermove', this.onMove);
    dom.addEventListener('pointerleave', this.onLeave);
    dom.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointerup', this.onUp);
  }

  setTool(tool: Tool) {
    this.stopStroke();
    this.tool = tool;
  }

  /** Where the cursor meets the ground, or null. */
  get cursor(): [number, number, number] | null {
    return this.hit;
  }

  update(delta: number, camera: Camera) {
    this.hit = null;
    if (!this.working || !this.inside) {
      this.ring.visible = false;
      return;
    }
    this.raycaster.setFromCamera(this.ndc, camera);
    const o = this.raycaster.ray.origin;
    const d = this.raycaster.ray.direction;
    this.hit = this.field.raycast([o.x, o.y, o.z], [d.x, d.y, d.z]);
    if (!this.hit) {
      this.ring.visible = false;
      return;
    }
    this.drawRing(this.hit[0], this.hit[2]);

    if (this.down) {
      const amount = (this.tool === 'dig' ? -1 : 1) * RATE * Math.min(delta, 0.05);
      // Save the tiles this dab can touch before changing them, for undo.
      this.history.touch(this.field.brushRect(this.hit[0], this.hit[2], this.radius));
      const edit = this.field.brush(this.hit[0], this.hit[2], this.radius, amount);
      this.history.record(edit.cut, edit.fill);
      if (edit.dirty) this.applyDirty(edit.dirty);
    }
  }

  private applyDirty(rect: Rect) {
    this.terrain.update(rect);
    this.onBedChanged(rect);
  }

  private drawRing(x: number, z: number) {
    const pos = this.ring.geometry.getAttribute('position') as BufferAttribute;
    for (let k = 0; k <= RING_SEGMENTS; k++) {
      const a = (k / RING_SEGMENTS) * Math.PI * 2;
      const px = x + Math.cos(a) * this.radius;
      const pz = z + Math.sin(a) * this.radius;
      pos.setXYZ(k, px, this.field.heightAt(px, pz) + 0.08, pz);
    }
    pos.needsUpdate = true;
    this.ring.visible = true;
  }

  dispose() {
    this.dom.removeEventListener('pointermove', this.onMove);
    this.dom.removeEventListener('pointerleave', this.onLeave);
    this.dom.removeEventListener('pointerdown', this.onDown);
    window.removeEventListener('pointerup', this.onUp);
    this.ring.geometry.dispose();
  }
}

