// The works plan: earthworks and structures laid out but not yet built. Each item keeps
// its *inputs* (where and how), not its result, so building it later reshapes the ground
// as it stands then. Costs are estimated from the ground as it is now.

import type { Structure } from '../mill/structures';
import { bedAt, centerline, type ChannelPlan, planChannel } from '../tools/channel';
import { type EmbankmentPlan, planEmbankment } from '../tools/embankment';
import { normalAt } from '../tools/pathView';
import { planWheelPit } from '../tools/pit';
import type { TerrainField } from '../world/terrainField';
import { addCosts, type Cost, earthworkCost, emptyCost, gateCost, wheelCost } from './costs';

export type PlanInput =
  | { kind: 'channel'; plan: ChannelPlan }
  | { kind: 'bank'; plan: EmbankmentPlan }
  | { kind: 'structure'; structure: Structure };

export interface PlanItem {
  id: string;
  label: string;
  input: PlanInput;
  cost: Cost;
}

export interface PlanSnapshot {
  items: PlanItem[];
  total: Cost;
}

/** Labor, materials and money for an item, from the ground as it is now. */
export function estimate(field: TerrainField, input: PlanInput): Cost {
  if (input.kind === 'channel') {
    const r = planChannel(field, input.plan);
    return earthworkCost(r.cut, r.cutRock, r.fill);
  }
  if (input.kind === 'bank') return earthworkCost(0, 0, planEmbankment(field, input.plan).fill);
  const s = input.structure;
  if (s.kind === 'gate') return gateCost(s.width);
  const pit = planWheelPit(field, s);
  const radius = s.pit?.radius ?? 2.4;
  return addCosts(earthworkCost(pit.cut, pit.cutRock, 0), wheelCost(radius * 2, s.width, pit.length, pit.depth));
}

/** Dashed outlines for an item's ghost in the scene. */
export function ghostLines(field: TerrainField, input: PlanInput): [number, number, number][][] {
  const lift = 0.12;
  const onGround = (x: number, z: number, y = -Infinity): [number, number, number] => [x, Math.max(y, field.heightAt(x, z)) + lift, z];
  if (input.kind === 'channel' || input.kind === 'bank') {
    const plan = input.plan;
    const line = centerline(plan.points, field.dx);
    const half = input.kind === 'channel' ? input.plan.bottomWidth / 2 + input.plan.depth * input.plan.sideSlope : input.plan.crestWidth / 2;
    const left: [number, number, number][] = [];
    const right: [number, number, number][] = [];
    const step = Math.max(1, Math.floor(line.x.length / 300));
    for (let k = 0; k < line.x.length; k += step) {
      const [nx, nz] = normalAt(line, k);
      const y = input.kind === 'channel' ? bedAt(input.plan, line.s[k]) + input.plan.depth : input.plan.crest;
      left.push(onGround(line.x[k] + nx * half, line.z[k] + nz * half, y));
      right.push(onGround(line.x[k] - nx * half, line.z[k] - nz * half, y));
    }
    return [left, right];
  }
  const s = input.structure;
  const box = (cx: number, cz: number, r: number) => [
    onGround(cx - r, cz - r),
    onGround(cx + r, cz - r),
    onGround(cx + r, cz + r),
    onGround(cx - r, cz + r),
    onGround(cx - r, cz - r),
  ];
  const lines = [
    [onGround(s.intake.x, s.intake.z), onGround(s.outlet.x, s.outlet.z)],
    box(s.intake.x, s.intake.z, 0.8),
    box(s.outlet.x, s.outlet.z, 0.8),
  ];
  if (s.kind === 'wheel' && s.pit) {
    // Outline of the pit the wheel will need.
    const dx = s.outlet.x - s.intake.x;
    const dz = s.outlet.z - s.intake.z;
    const len = Math.hypot(dx, dz) || 1;
    const ux = dx / len;
    const uz = dz / len;
    const w = (s.width + 1.2) / 2;
    const at = (along: number, across: number) => onGround(s.intake.x + ux * along - uz * across, s.intake.z + uz * along + ux * across);
    lines.push([at(s.pit.start, -w), at(len, -w), at(len, w), at(s.pit.start, w), at(s.pit.start, -w)]);
  }
  return lines;
}

function kindName(input: PlanInput): string {
  if (input.kind === 'channel') return 'Race';
  if (input.kind === 'bank') return 'Bank';
  return input.structure.kind === 'wheel' ? 'Wheel' : 'Head gate';
}

export interface PlanEnv {
  field: TerrainField;
  /** Names already in use elsewhere (jobs under way, structures), so new items don't repeat them. */
  usedLabels?: () => string[];
  /** Build one item now; return false if it couldn't be built. */
  build: (item: PlanItem) => boolean;
}

export class PlanBook {
  items: PlanItem[] = [];
  env: PlanEnv | null = null;
  private counter = 0;
  /** Numbering per kind ("Race 1", "Wheel 1"), counting everything planned this session. */
  private perKind = new Map<string, number>();
  private snapshot: PlanSnapshot = { items: [], total: emptyCost() };
  private listeners = new Set<() => void>();
  /** Bumped whenever the items change, so the ghosts know to redraw. */
  version = 0;

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getSnapshot = () => this.snapshot;

  add(input: PlanInput | null): PlanItem | null {
    if (!input || !this.env) return null;
    this.counter++;
    const name = kindName(input);
    const used = new Set([...this.items.map((i) => i.label), ...(this.env.usedLabels?.() ?? [])]);
    let n = (this.perKind.get(name) ?? 0) + 1;
    while (used.has(`${name} ${n}`)) n++;
    this.perKind.set(name, n);
    const item: PlanItem = { id: `plan-${Date.now().toString(36)}-${this.counter}`, label: `${name} ${n}`, input, cost: estimate(this.env.field, input) };
    this.items = [...this.items, item];
    this.changed();
    return item;
  }

  remove(id: string) {
    this.items = this.items.filter((i) => i.id !== id);
    this.changed();
  }

  /** Build an item now and take it off the plan. */
  build(id: string): boolean {
    const item = this.items.find((i) => i.id === id);
    if (!item || !this.env) return false;
    if (!this.env.build(item)) return false;
    this.remove(id);
    this.reestimate();
    return true;
  }

  /** Build everything, in plan order. */
  buildAll(): number {
    let n = 0;
    for (const item of [...this.items]) if (this.build(item.id)) n++;
    return n;
  }

  /** Re-cost every item against the ground as it is now (after other works changed it). */
  reestimate() {
    if (!this.env) return;
    const field = this.env.field;
    this.items = this.items.map((i) => ({ ...i, cost: estimate(field, i.input) }));
    this.changed();
  }

  restore(items: PlanItem[]) {
    this.items = items.map((i) => ({ ...i }));
    this.counter = Math.max(this.counter, items.length);
    // Keep numbering past what the save already uses.
    for (const i of items) {
      const m = /^(.*) (\d+)$/.exec(i.label);
      if (m) this.perKind.set(m[1], Math.max(this.perKind.get(m[1]) ?? 0, Number(m[2])));
    }
    this.reestimate();
    this.changed();
  }

  private changed() {
    this.version++;
    this.snapshot = { items: this.items, total: this.items.reduce((a, i) => addCosts(a, i.cost), emptyCost()) };
    for (const fn of this.listeners) fn();
  }
}
