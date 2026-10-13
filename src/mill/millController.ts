import type { GridInfo, SimStats } from '../water/protocol';
import type { Link } from '../water/shallowWater';
import { FLUME_LOSS, GATE_MAX, MILL_LINK_ID, millLink } from './siteMill';
import { BREASTSHOT, runMill, SASH_SAW, wheelEfficiency, wheelPower } from './wheel';

export interface MillSnapshot {
  gate: number;
  gateMax: number;
  /** Water through the wheel, m^3/s. */
  discharge: number;
  /** Fall from the flume to the tailrace, m. */
  head: number;
  efficiency: number;
  wheelHp: number;
  deliveredHp: number;
  /** Saw speed, 0..1. */
  speed: number;
  /** Board feet per hour at the current speed. */
  perHour: number;
  spareHp: number;
  /** Board feet cut so far. */
  lumber: number;
  pondLevel: number | null;
  simTime: number;
}

/** The working mill: head gate setting in, power and lumber out. */
export class MillController {
  gate = 0.25;
  lumber = 0;
  private grid: GridInfo | null = null;
  private send: ((link: Link) => void) | null = null;
  private lastTime: number | null = null;
  private snapshot: MillSnapshot = this.idle();
  private listeners = new Set<() => void>();
  private lastEmit = 0;

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getSnapshot = () => this.snapshot;

  private idle(): MillSnapshot {
    return {
      gate: this.gate,
      gateMax: GATE_MAX,
      discharge: 0,
      head: 0,
      efficiency: 0,
      wheelHp: 0,
      deliveredHp: 0,
      speed: 0,
      perHour: 0,
      spareHp: 0,
      lumber: this.lumber,
      pondLevel: null,
      simTime: 0,
    };
  }

  /** Connect to the water sim once its grid is known. */
  attach(grid: GridInfo, send: (link: Link) => void) {
    this.grid = grid;
    this.send = send;
    this.lastTime = null;
    send(millLink(grid, this.gate));
  }

  setGate(opening: number) {
    this.gate = Math.max(0, Math.min(GATE_MAX, opening));
    if (this.grid && this.send) this.send(millLink(this.grid, this.gate));
    this.snapshot = { ...this.snapshot, gate: this.gate };
    this.emit();
  }

  /** Restore from a save (or reset): the clock restarts so no lumber is credited for the gap. */
  restore(gate: number, lumber: number) {
    this.lumber = lumber;
    this.lastTime = null;
    this.setGate(gate);
  }

  /** Feed each new sim state; integrates lumber over simulated time. */
  update(stats: SimStats, now: number) {
    const link = stats.links.find((l) => l.id === MILL_LINK_ID);
    const discharge = link?.discharge ?? 0;
    const head = link ? Math.max(0, link.etaFrom - link.etaTo - FLUME_LOSS) : 0;
    const run = runMill(wheelPower(BREASTSHOT, discharge, head), SASH_SAW);
    if (this.lastTime !== null) {
      const dt = stats.time - this.lastTime;
      // A big jump means a restart or load, not milling time.
      if (dt > 0 && dt < 600) this.lumber += (run.perHour * dt) / 3600;
    }
    this.lastTime = stats.time;
    this.snapshot = {
      gate: this.gate,
      gateMax: GATE_MAX,
      discharge,
      head,
      efficiency: wheelEfficiency(BREASTSHOT, head),
      wheelHp: run.wheelHp,
      deliveredHp: run.deliveredHp,
      speed: run.speed,
      perHour: run.perHour,
      spareHp: run.spareHp,
      lumber: this.lumber,
      pondLevel: stats.pondLevel,
      simTime: stats.time,
    };
    if (now - this.lastEmit > 250) {
      this.lastEmit = now;
      this.emit();
    }
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }
}
