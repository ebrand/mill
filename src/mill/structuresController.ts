import type { GridInfo, SimStats } from '../water/protocol';
import type { Link } from '../water/shallowWater';
import { siteMillStructure } from './siteMill';
import { type Structure, structureLink, wheelHead } from './structures';
import { BREASTSHOT, runMill, SASH_SAW, wheelEfficiency, wheelPower } from './wheel';

export interface StructureView {
  id: string;
  kind: Structure['kind'];
  name: string;
  builtIn: boolean;
  opening: number;
  maxOpening: number;
  /** m^3/s through the structure. */
  discharge: number;
  /** Water level at intake and outlet. */
  etaFrom: number;
  etaTo: number;
  /** Wheels only: */
  head: number;
  efficiency: number;
  wheelHp: number;
  deliveredHp: number;
  speed: number;
  perHour: number;
  spareHp: number;
  lumber: number;
}

export interface StructuresSnapshot {
  structures: StructureView[];
  totalHp: number;
  totalLumber: number;
}

interface SimHooks {
  setLink: (link: Link) => void;
  removeLink: (id: string) => void;
}

/** All placed gates and wheels: their settings, their links in the sim, and what they make. */
export class StructuresController {
  structures: Structure[] = [siteMillStructure()];
  private grid: GridInfo | null = null;
  private hooks: SimHooks | null = null;
  private lastTime: number | null = null;
  private views = new Map<string, StructureView>();
  private snapshot: StructuresSnapshot = { structures: [], totalHp: 0, totalLumber: 0 };
  private listeners = new Set<() => void>();
  private lastEmit = 0;

  constructor() {
    this.rebuildSnapshot();
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getSnapshot = () => this.snapshot;

  get(id: string): Structure | undefined {
    return this.structures.find((s) => s.id === id);
  }

  /** Connect to the water sim once its grid is known; sends every structure's link. */
  attach(grid: GridInfo, hooks: SimHooks) {
    this.grid = grid;
    this.hooks = hooks;
    this.lastTime = null;
    for (const s of this.structures) hooks.setLink(structureLink(grid, s));
  }

  private push(s: Structure) {
    if (this.grid && this.hooks) this.hooks.setLink(structureLink(this.grid, s));
  }

  add(s: Structure) {
    this.structures = [...this.structures, s];
    this.push(s);
    this.rebuildSnapshot();
  }

  remove(id: string) {
    const s = this.get(id);
    if (!s || s.builtIn) return;
    this.structures = this.structures.filter((x) => x.id !== id);
    this.hooks?.removeLink(id);
    this.views.delete(id);
    this.rebuildSnapshot();
  }

  setOpening(id: string, opening: number) {
    const s = this.get(id);
    if (!s) return;
    s.opening = Math.max(0, Math.min(s.maxOpening, opening));
    this.push(s);
    this.rebuildSnapshot();
  }

  /** Replace everything (loading a save). The clock restarts so no output is credited for the gap. */
  restore(structures: Structure[]) {
    for (const s of this.structures) if (!structures.some((n) => n.id === s.id)) this.hooks?.removeLink(s.id);
    this.structures = structures.map((s) => ({ ...s }));
    for (const s of this.structures) this.push(s);
    this.views.clear();
    this.lastTime = null;
    this.rebuildSnapshot();
  }

  /** Feed each new sim state; works out power and integrates output over simulated time. */
  update(stats: SimStats, now: number) {
    const dt = this.lastTime === null ? 0 : stats.time - this.lastTime;
    this.lastTime = stats.time;
    // A big jump means a restart or load, not milling time.
    const credit = dt > 0 && dt < 600 ? dt : 0;
    for (const s of this.structures) {
      const ls = stats.links.find((l) => l.id === s.id);
      const discharge = ls?.discharge ?? 0;
      const etaFrom = ls?.etaFrom ?? 0;
      const etaTo = ls?.etaTo ?? 0;
      if (s.kind === 'wheel') {
        const head = ls ? wheelHead(etaFrom, etaTo) : 0;
        const run = runMill(wheelPower(BREASTSHOT, discharge, head), SASH_SAW);
        s.lumber += (run.perHour * credit) / 3600;
        this.views.set(s.id, {
          ...this.base(s),
          discharge,
          etaFrom,
          etaTo,
          head,
          efficiency: wheelEfficiency(BREASTSHOT, head),
          wheelHp: run.wheelHp,
          deliveredHp: run.deliveredHp,
          speed: run.speed,
          perHour: run.perHour,
          spareHp: run.spareHp,
        });
      } else {
        this.views.set(s.id, { ...this.base(s), discharge, etaFrom, etaTo });
      }
    }
    if (now - this.lastEmit > 250) {
      this.lastEmit = now;
      this.rebuildSnapshot();
    }
  }

  private base(s: Structure): StructureView {
    return {
      id: s.id,
      kind: s.kind,
      name: s.name,
      builtIn: !!s.builtIn,
      opening: s.opening,
      maxOpening: s.maxOpening,
      discharge: 0,
      etaFrom: 0,
      etaTo: 0,
      head: 0,
      efficiency: 0,
      wheelHp: 0,
      deliveredHp: 0,
      speed: 0,
      perHour: 0,
      spareHp: 0,
      lumber: s.lumber,
    };
  }

  private rebuildSnapshot() {
    const structures = this.structures.map((s) => ({ ...(this.views.get(s.id) ?? this.base(s)), opening: s.opening, lumber: s.lumber, name: s.name }));
    this.snapshot = {
      structures,
      totalHp: structures.reduce((a, v) => a + v.wheelHp, 0),
      totalLumber: structures.reduce((a, v) => a + v.lumber, 0),
    };
    for (const fn of this.listeners) fn();
  }

  /** Discharge currently passing a structure (for animating it). */
  dischargeOf(id: string): number {
    return this.views.get(id)?.discharge ?? 0;
  }
}
