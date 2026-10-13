// The calendar and the building site together, for the UI: days pass at a chosen rate
// (independent of the water's clock), and each day the crews work.

import type { PlanItem } from '../plan/planBook';
import { Construction, type ConstructionEnv, type Crews, type JobStatus } from './construction';

export const START_DATE = new Date(1812, 3, 1); // 1 April 1812
/** Calendar speeds, days per real second. */
export const DAY_SPEEDS = [0, 0.25, 1, 4];

export interface JobView {
  id: string;
  label: string;
  status: JobStatus;
  /** 0..1 across all its trades. */
  progress: number;
}

export interface ConstructionSnapshot {
  date: string;
  day: number;
  money: number;
  crews: Crews;
  dailyWages: number;
  speedIndex: number;
  jobs: JobView[];
  log: { date: string; text: string }[];
  /** Lumber sold so far, dollars. */
  income: number;
}

export function dateOf(day: number): string {
  const d = new Date(START_DATE);
  d.setDate(d.getDate() + day);
  return d.toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' });
}

/** Sawn lumber sells for this, dollars per 1,000 board feet (estimate). */
export const LUMBER_PRICE = 10;

export interface ConstructionSave {
  day: number;
  money: number;
  crews: Crews;
  jobs: Construction['jobs'];
  log: Construction['log'];
  income?: number;
  speedIndex?: number;
}

export class ConstructionController {
  readonly site = new Construction(null);
  speedIndex = 0;
  /** Called with whole days worked; returns board feet the mills cut in that time. */
  produce: ((days: number) => number) | null = null;
  /** Lumber sold so far, dollars. */
  income = 0;
  private carry = 0;
  private snapshot: ConstructionSnapshot = this.build();
  private listeners = new Set<() => void>();

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getSnapshot = () => this.snapshot;

  set env(env: ConstructionEnv | null) {
    this.site.env = env;
  }

  private build(): ConstructionSnapshot {
    const s = this.site;
    return {
      date: dateOf(s.day),
      day: s.day,
      money: s.money,
      crews: { ...s.crews },
      dailyWages: s.dailyWages,
      speedIndex: this.speedIndex,
      jobs: s.jobs.map((j) => {
        const c = j.item.cost;
        const need = c.laborerDays + c.masonDays + c.millwrightDays;
        const done = j.done.laborer + j.done.mason + j.done.millwright;
        return { id: j.item.id, label: j.item.label, status: j.status, progress: need > 0 ? Math.min(1, done / need) : j.status === 'done' ? 1 : 0 };
      }),
      log: s.log.map((l) => ({ date: dateOf(l.day), text: l.text })),
      income: this.income,
    };
  }

  private emit() {
    this.snapshot = this.build();
    for (const fn of this.listeners) fn();
  }

  setSpeed(index: number) {
    this.speedIndex = Math.max(0, Math.min(DAY_SPEEDS.length - 1, index));
    this.emit();
  }

  hire(trade: keyof Crews, count: number) {
    this.site.crews = { ...this.site.crews, [trade]: Math.max(0, Math.min(200, Math.round(count))) };
    this.emit();
  }

  start(item: PlanItem) {
    this.site.enqueue(item);
    this.emit();
  }

  clearDone() {
    this.site.clearDone();
    this.emit();
  }

  /** Call every frame with real elapsed seconds; works whole days. Returns days worked. */
  update(delta: number): number {
    this.carry += Math.min(delta, 0.25) * DAY_SPEEDS[this.speedIndex];
    let days = 0;
    while (this.carry >= 1 && days < 8) {
      this.carry -= 1;
      this.site.tick();
      // The mills work the day too; their lumber is sold at once.
      const bf = this.produce?.(1) ?? 0;
      const dollars = (bf / 1000) * LUMBER_PRICE;
      this.site.money += dollars;
      this.income += dollars;
      days++;
    }
    if (days > 0) this.emit();
    return days;
  }

  save(): ConstructionSave {
    const s = this.site;
    return { day: s.day, money: s.money, crews: { ...s.crews }, jobs: s.jobs.map((j) => ({ ...j, done: { ...j.done } })), log: [...s.log], income: this.income, speedIndex: this.speedIndex };
  }

  restore(save: ConstructionSave | undefined, startingMoney = 2000) {
    const s = this.site;
    s.day = save?.day ?? 0;
    s.money = save?.money ?? startingMoney;
    s.crews = save ? { ...save.crews } : { laborers: 0, masons: 0, millwrights: 0 };
    s.jobs = save ? save.jobs.map((j) => ({ ...j, done: { ...j.done } })) : [];
    s.log = save ? [...save.log] : [];
    this.income = save?.income ?? 0;
    this.speedIndex = 0; // loading always starts paused
    this.carry = 0;
    this.emit();
  }
}
