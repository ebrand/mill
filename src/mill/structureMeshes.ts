import { Group, type Mesh } from 'three';
import { lowestGround } from '../plan/planBook';
import { createGateModel, createSpillwayModel, createWheelModel } from '../scene/buildSite';
import type { TerrainField } from '../world/terrainField';
import { type Structure, wheelGeometry } from './structures';
import type { StructuresController } from './structuresController';

interface Drawn {
  key: string;
  group: Group;
  spin?: Group;
  plank?: Mesh;
  sheet?: Mesh;
  sill: number;
}

/** Draws placed (not built-in) structures, and animates wheels and gates from the sim. */
export class StructureMeshes {
  readonly group = new Group();
  private drawn = new Map<string, Drawn>();

  constructor(
    private readonly structures: StructuresController,
    private readonly field: TerrainField,
    /** Water surface at a point (null if dry or unknown), to tell which side is downstream. */
    private readonly waterAt: (x: number, z: number) => number | null = () => null,
  ) {}

  /** A structure's model only depends on where it is and its size. */
  private key(s: Structure): string {
    return [s.kind, s.intake.x, s.intake.z, s.outlet.x, s.outlet.z, s.width, s.sill, this.side(s)].join(':');
  }

  /** For a spillway, which side is downstream now (+1 or -1), so the model turns if the pond forms later. */
  private side(s: Structure): number {
    if (s.kind !== 'spillway') return 0;
    const dx = s.outlet.x - s.intake.x;
    const dz = s.outlet.z - s.intake.z;
    const len = Math.hypot(dx, dz) || 1;
    const mx = (s.intake.x + s.outlet.x) / 2;
    const mz = (s.intake.z + s.outlet.z) / 2;
    const a = this.waterAt(mx - (dz / len) * 4, mz + (dx / len) * 4);
    const b = this.waterAt(mx + (dz / len) * 4, mz - (dx / len) * 4);
    if (a === null || b === null || Math.abs(a - b) < 0.05) return 0;
    return a > b ? 1 : -1;
  }

  private build(s: Structure): Drawn {
    const g = new Group();
    const dx = s.outlet.x - s.intake.x;
    const dz = s.outlet.z - s.intake.z;
    // Local X runs from intake to outlet (the direction of flow); the axle lies across it.
    const heading = Math.atan2(-dz, dx);
    if (s.kind === 'spillway') {
      const len = Math.hypot(dx, dz) || 1;
      const foot = lowestGround(this.field, s.intake, s.outlet) - 0.3;
      const model = createSpillwayModel(len, s.sill - foot);
      g.position.set((s.intake.x + s.outlet.x) / 2, foot, (s.intake.z + s.outlet.z) / 2);
      // Local X along the crest; turn so the sheet (local +Z) faces the lower, downstream side.
      const nx = -dz / len;
      const nz = dx / len;
      const mx = (s.intake.x + s.outlet.x) / 2;
      const mz = (s.intake.z + s.outlet.z) / 2;
      // Upstream is where the water stands higher; across a river the ground alone can't tell.
      const level = (x: number, z: number) => this.waterAt(x, z) ?? this.field.heightAt(x, z);
      const plus = level(mx + nx * 4, mz + nz * 4);
      const minus = level(mx - nx * 4, mz - nz * 4);
      // Rotating by the heading puts local +Z on the +n side; flip if that's the upstream side.
      g.rotation.y = Math.atan2(-dz, dx) + (plus > minus ? Math.PI : 0);
      g.add(model.group);
      return { key: this.key(s), group: g, sheet: model.sheet, sill: s.sill };
    }
    if (s.kind === 'wheel') {
      const geo = s.pit ?? { ...wheelGeometry(s.sill, this.field.heightAt(s.outlet.x, s.outlet.z)), start: 0 };
      const r = geo.radius;
      const len = Math.hypot(dx, dz) || 1;
      // In its pit: just past the breast, bottom a little off the pit floor.
      const along = s.pit ? s.pit.start + r + 0.5 : len / 2;
      const model = createWheelModel(r, s.width);
      g.position.set(s.intake.x + (dx / len) * along, geo.floor + 0.3 + r, s.intake.z + (dz / len) * along);
      g.rotation.y = heading;
      g.add(model.group);
      return { key: this.key(s), group: g, spin: model.spin, sill: s.sill };
    }
    // Tall enough to stand clear of the bank or dam it passes through (the dam's stone
    // abutments are drawn as solid blocks up to about 2.6 m).
    const ground = Math.max(this.field.heightAt(s.intake.x, s.intake.z), this.field.heightAt(s.outlet.x, s.outlet.z));
    const height = Math.max(3, ground + 1.5 - s.sill);
    const model = createGateModel(s.width, height);
    g.position.set((s.intake.x + s.outlet.x) / 2, s.sill, (s.intake.z + s.outlet.z) / 2);
    g.rotation.y = heading;
    g.add(model.group);
    return { key: this.key(s), group: g, plank: model.plank, sill: s.sill };
  }

  /** Add, move or remove models to match the structures; turn wheels and raise gates. */
  update(delta: number, simSpeed: number) {
    const live = new Set<string>();
    for (const s of this.structures.structures) {
      if (s.builtIn) continue;
      live.add(s.id);
      let d = this.drawn.get(s.id);
      if (!d || d.key !== this.key(s)) {
        if (d) this.group.remove(d.group);
        d = this.build(s);
        this.drawn.set(s.id, d);
        this.group.add(d.group);
      }
      // Bottom of the wheel moves downstream (+local X), as on the original mill.
      if (d.spin) d.spin.rotation.z += delta * simSpeed * 0.75 * Math.min(1, this.structures.dischargeOf(s.id) / 2.5);
      if (d.sheet) d.sheet.visible = this.structures.dischargeOf(s.id) > 0.2;
      if (d.plank) d.plank.position.y = s.opening + (d.plank.geometry as unknown as { parameters: { height: number } }).parameters.height / 2;
    }
    for (const [id, d] of this.drawn) {
      if (live.has(id)) continue;
      this.group.remove(d.group);
      this.drawn.delete(id);
    }
  }
}
