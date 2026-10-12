import { BufferAttribute, BufferGeometry, type Camera, LineLoop, Raycaster, Vector2 } from 'three';
import { vec4 } from 'three/tsl';
import { LineBasicNodeMaterial } from 'three/webgpu';
import type { Rect, TerrainField } from '../world/terrainField';
import type { TerrainMeshes } from '../world/terrainMesh';

export type Tool = 'look' | 'dig' | 'fill';

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
  /** Running totals, m^3. */
  cut = 0;
  fill = 0;
  readonly ring: LineLoop;

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
    this.down = false;
  };
  private readonly onDown = (e: PointerEvent) => {
    if (e.button === 0 && this.tool !== 'look') this.down = true;
  };
  private readonly onUp = (e: PointerEvent) => {
    if (e.button === 0) this.down = false;
  };

  constructor(
    private readonly field: TerrainField,
    private readonly terrain: TerrainMeshes,
    private readonly dom: HTMLElement,
    private readonly onBedChanged: (rect: Rect) => void,
  ) {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(RING_SEGMENTS * 3), 3));
    const material = new LineBasicNodeMaterial();
    // Full ink, surface id 0, no wash.
    material.outputNode = vec4(1, 1, 0, 0);
    this.ring = new LineLoop(g, material);
    this.ring.frustumCulled = false;
    this.ring.visible = false;
    dom.addEventListener('pointermove', this.onMove);
    dom.addEventListener('pointerleave', this.onLeave);
    dom.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointerup', this.onUp);
  }

  setTool(tool: Tool) {
    this.tool = tool;
    this.down = false;
  }

  /** Where the cursor meets the ground, or null. */
  get cursor(): [number, number, number] | null {
    return this.hit;
  }

  update(delta: number, camera: Camera) {
    this.hit = null;
    if (this.tool === 'look' || !this.inside) {
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
      const edit = this.field.brush(this.hit[0], this.hit[2], this.radius, amount);
      this.cut += edit.cut;
      this.fill += edit.fill;
      if (edit.dirty) this.applyDirty(edit.dirty);
    }
  }

  private applyDirty(rect: Rect) {
    this.terrain.update(rect);
    this.onBedChanged(rect);
  }

  private drawRing(x: number, z: number) {
    const pos = this.ring.geometry.getAttribute('position') as BufferAttribute;
    for (let k = 0; k < RING_SEGMENTS; k++) {
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

