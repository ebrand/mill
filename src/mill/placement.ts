// Placing a gate or wheel: two clicks (intake, then outlet), a live preview read from the
// water as it stands, and warnings that explain why a site won't work.

import type { WaterClient } from '../water/WaterClient';
import { gateDischarge } from '../water/shallowWater';
import type { TerrainField } from '../world/terrainField';
import type { PathSource } from '../tools/pathView';
import { planPit, type PitResult } from '../tools/pit';
import type { Rect } from '../world/terrainField';
import { BREAST, newStructureId, pitLength, type Structure, type StructureKind, WHEEL_ENTRY_LOSS, wheelGeometry } from './structures';
import { BREASTSHOT, runMill, SASH_SAW, wheelEfficiency, wheelPower } from './wheel';

export interface PlacementParams {
  width: number;
  opening: number;
  /** Sill elevation; null = automatic (the higher of the ground at intake and outlet). */
  sill: number | null;
}

export interface PlacementPreview {
  kind: StructureKind;
  points: number;
  params: PlacementParams;
  sill: number | null;
  length: number;
  intakeLevel: number | null;
  intakeWet: boolean;
  outletLevel: number | null;
  outletWet: boolean;
  /** Wheels: fall available, m. */
  head: number;
  efficiency: number;
  /** Expected flow at the current opening, m^3/s. */
  discharge: number;
  wheelHp: number;
  sawSpeed: number;
  warnings: string[];
}

export interface PlacementEnv {
  field: TerrainField;
  water: () => WaterClient | null;
  /** Called with the new structure when the player builds it. */
  onBuild: (s: Structure) => void;
  /** A wheel digs its pit: called before the ground changes (for undo) and after. */
  beforeDig?: (rect: Rect, label: string) => void;
  onDig?: (pit: PitResult) => void;
}

const DEFAULTS: Record<StructureKind, PlacementParams> = {
  gate: { width: 2, opening: 0.3, sill: null },
  wheel: { width: 2.2, opening: 0.3, sill: null },
};
const MAX_OPENING: Record<StructureKind, number> = { gate: 1.0, wheel: 0.6 };
/** Beyond this the "wheel" is really a long flume; warn. */
const WHEEL_MAX_SPAN = 25;

export class PlacementController implements PathSource {
  points: { x: number; z: number }[] = [];
  params: PlacementParams;
  env: PlacementEnv | null = null;
  private preview: PlacementPreview;
  private listeners = new Set<() => void>();
  private dirty = true;
  private lastCompute = 0;
  private built = 0;

  constructor(readonly kind: StructureKind) {
    this.params = { ...DEFAULTS[kind] };
    this.preview = this.empty();
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getSnapshot = () => this.preview;

  private empty(): PlacementPreview {
    return {
      kind: this.kind,
      points: this.points.length,
      params: { ...this.params },
      sill: null,
      length: 0,
      intakeLevel: null,
      intakeWet: false,
      outletLevel: null,
      outletWet: false,
      head: 0,
      efficiency: 0,
      discharge: 0,
      wheelHp: 0,
      sawSpeed: 0,
      warnings: [],
    };
  }

  addPoint(x: number, z: number) {
    // Intake, then outlet; a third click moves the outlet.
    if (this.points.length < 2) this.points.push({ x, z });
    else this.points[1] = { x, z };
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
  setParam<K extends keyof PlacementParams>(key: K, value: PlacementParams[K]) {
    this.params = { ...this.params, [key]: value };
    this.dirty = true;
  }

  /** Recompute at most ~5 times a second; the water keeps moving, so always mark dirty again. */
  update(now: number) {
    if (now - this.lastCompute < 200) return;
    if (!this.dirty && this.points.length < 2) return;
    this.lastCompute = now;
    this.dirty = false;
    this.recompute();
  }

  private level(x: number, z: number): { level: number; wet: boolean } {
    const w = this.env?.water()?.surfaceAt(x, z);
    if (w && w.depth > 0.05) return { level: w.eta, wet: true };
    return { level: this.env!.field.heightAt(x, z), wet: false };
  }

  private recompute() {
    if (!this.env || this.points.length === 0) {
      this.preview = this.empty();
      this.emit();
      return;
    }
    const field = this.env.field;
    const a = this.points[0];
    const intake = this.level(a.x, a.z);
    const p: PlacementPreview = { ...this.empty(), intakeLevel: intake.level, intakeWet: intake.wet };
    const warnings: string[] = [];
    if (!intake.wet) warnings.push('The intake is dry: put it in the pond or at the end of a filled race.');
    if (this.points.length === 2) {
      const b = this.points[1];
      const outlet = this.level(b.x, b.z);
      // The sill sits at the floor of the race: for a head gate that's the race it feeds (the
      // outlet side; the pond edge it draws from can be much shallower), for a wheel it's the
      // end of the race it draws on (the intake side).
      const floor = this.kind === 'gate' ? field.heightAt(b.x, b.z) : field.heightAt(a.x, a.z);
      const sill = this.params.sill ?? Math.round(floor * 20) / 20;
      p.sill = sill;
      p.outletLevel = outlet.level;
      p.outletWet = outlet.wet;
      p.length = Math.hypot(b.x - a.x, b.z - a.z);
      if (outlet.level >= intake.level) warnings.push('The outlet is as high as the intake: water won’t flow through.');
      if (intake.wet && intake.level <= sill) warnings.push('The sill is above the water at the intake: opening the gate passes nothing.');
      let q = intake.wet ? gateDischarge(intake.level, outlet.level, sill, this.params.opening, this.params.width) : 0;
      if (this.kind === 'wheel') {
        q = Math.min(q, BREASTSHOT.maxDischarge);
        const head = Math.max(0, intake.level - outlet.level - WHEEL_ENTRY_LOSS);
        const [lo, hi] = BREASTSHOT.designHead;
        if (head > 0 && head < lo) warnings.push(`A fall of ${head.toFixed(1)} m is below a breastshot wheel’s best range (${lo}–${hi} m).`);
        if (head > hi) warnings.push(`A fall of ${head.toFixed(1)} m is more than a breastshot wheel can use well (${lo}–${hi} m).`);
        if (p.length > WHEEL_MAX_SPAN) warnings.push('Intake and outlet are far apart for one wheel; bring the race closer.');
        const geo = wheelGeometry(sill, field.heightAt(b.x, b.z));
        const needed = BREAST + pitLength(geo.radius);
        if (p.length < needed) warnings.push(`Leave ${needed.toFixed(0)} m from intake to outlet: room for a breast of earth and a ${(geo.radius * 2).toFixed(1)} m wheel in its pit.`);
        const run = runMill(wheelPower(BREASTSHOT, q, head), SASH_SAW);
        p.head = head;
        p.efficiency = wheelEfficiency(BREASTSHOT, head);
        p.wheelHp = run.wheelHp;
        p.sawSpeed = run.speed;
      }
      p.discharge = q;
      if (p.length < 1) warnings.push('Intake and outlet are too close together.');
    }
    p.points = this.points.length;
    p.params = { ...this.params };
    p.warnings = warnings;
    this.preview = p;
    this.emit();
  }

  /** Build it. Returns the structure, or null if there's nothing to build. */
  commit(): Structure | null {
    if (!this.env || this.points.length < 2 || this.preview.sill === null) return null;
    this.built++;
    let pit: Structure['pit'];
    if (this.kind === 'wheel') {
      // Dig the wheel pit, leaving a breast of earth between the race and the pit.
      const a = this.points[0];
      const b = this.points[1];
      const geo = wheelGeometry(this.preview.sill, this.env.field.heightAt(b.x, b.z));
      const plan = planPit(this.env.field, a, b, BREAST, this.params.width + 1.2, geo.floor);
      this.env.beforeDig?.(plan.rect, 'wheel pit');
      const w = plan.rect.i1 - plan.rect.i0;
      for (let j = plan.rect.j0; j < plan.rect.j1; j++)
        for (let i = plan.rect.i0; i < plan.rect.i1; i++)
          this.env.field.heights[j * this.env.field.nx + i] = plan.heights[(j - plan.rect.j0) * w + (i - plan.rect.i0)];
      this.env.onDig?.(plan);
      pit = { start: BREAST, floor: geo.floor, radius: geo.radius };
    }
    const s: Structure = {
      id: newStructureId(this.kind),
      kind: this.kind,
      name: this.kind === 'wheel' ? `Wheel ${this.built}` : `Gate ${this.built}`,
      intake: { ...this.points[0] },
      outlet: { ...this.points[1] },
      width: this.params.width,
      sill: this.preview.sill,
      opening: this.params.opening,
      maxOpening: MAX_OPENING[this.kind],
      lumber: 0,
      pit,
    };
    this.env.onBuild(s);
    this.clear();
    return s;
  }

  previewLines(): [number, number, number][][] {
    if (!this.env || this.points.length < 2) return [];
    const [a, b] = this.points;
    const la = this.level(a.x, a.z).level;
    const lb = this.level(b.x, b.z).level;
    const n = 24;
    const line: [number, number, number][] = [];
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const x = a.x + (b.x - a.x) * t;
      const z = a.z + (b.z - a.z) * t;
      const y = Math.max(this.env.field.heightAt(x, z), la + (lb - la) * t) + 0.15;
      line.push([x, y, z]);
    }
    return [line];
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }
}
