// Construction over calendar days. Crews are hired and paid daily; works from the plan are
// queued and done in order: earth first, then masonry, then millwork. Materials are bought
// when a job starts and arrive after a lead time. Earthworks reshape the ground a little
// each day, so the river responds while the work goes on. Pure (no three.js): the scene
// supplies callbacks.

import { RATES, type Cost } from '../plan/costs';
import type { PlanItem } from '../plan/planBook';
import type { Rect, TerrainField } from '../world/terrainField';

/** Days from ordering to delivery (estimates). */
export const LEAD_DAYS = { stone: 4, timber: 6, iron: 10 };

export interface Crews {
  laborers: number;
  masons: number;
  millwrights: number;
}

export type JobStatus = 'waiting for money' | 'waiting for the ground' | 'earthwork' | 'waiting for materials' | 'masonry' | 'millwork' | 'done';

export interface Job {
  item: PlanItem;
  status: JobStatus;
  /** Trade-days done so far. */
  done: { laborer: number; mason: number; millwright: number };
  /** Day the materials arrive (null until ordered). */
  materialsDay: number | null;
  /** Earthwork: the ground before, and the shape it's heading for (set when digging starts). */
  rect: Rect | null;
  original: Float32Array | null;
  target: Float32Array | null;
}

export interface Ledger {
  day: number;
  text: string;
}

export interface ConstructionEnv {
  field: TerrainField;
  /** Work out an item's earthwork against the ground as it is now (null = no earthwork). */
  earthwork: (item: PlanItem) => { rect: Rect; heights: Float32Array } | null;
  /** The ground in `rect` changed. */
  onTerrain: (rect: Rect) => void;
  /** A job finished: put up its structure, if it has one. */
  onComplete: (item: PlanItem) => void;
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.i0 < b.i1 && b.i0 < a.i1 && a.j0 < b.j1 && b.j0 < a.j1;
}

export class Construction {
  money: number;
  crews: Crews = { laborers: 0, masons: 0, millwrights: 0 };
  jobs: Job[] = [];
  log: Ledger[] = [];
  /** Whole days elapsed since the start. */
  day = 0;
  private idleNoted = false;

  constructor(
    public env: ConstructionEnv | null,
    startingMoney = 2000,
  ) {
    this.money = startingMoney;
  }

  get dailyWages(): number {
    const c = this.crews;
    return c.laborers * RATES.laborerWage + c.masons * RATES.masonWage + c.millwrights * RATES.millwrightWage;
  }

  enqueue(item: PlanItem) {
    this.jobs.push({ item, status: 'waiting for money', done: { laborer: 0, mason: 0, millwright: 0 }, materialsDay: null, rect: null, original: null, target: null });
  }

  /** Remaining trade-days for a job. */
  remaining(job: Job): { laborer: number; mason: number; millwright: number } {
    const c = job.item.cost;
    return {
      laborer: Math.max(0, c.laborerDays - job.done.laborer),
      mason: Math.max(0, c.masonDays - job.done.mason),
      millwright: Math.max(0, c.millwrightDays - job.done.millwright),
    };
  }

  private materialsCost(c: Cost): number {
    return c.stoneYd3 * RATES.stonePerYd3 + (c.timberBf / 1000) * RATES.timberPer1000bf + c.ironLb * RATES.ironPerLb;
  }

  private leadDays(c: Cost): number {
    let d = 0;
    if (c.stoneYd3 > 0) d = Math.max(d, LEAD_DAYS.stone);
    if (c.timberBf > 0) d = Math.max(d, LEAD_DAYS.timber);
    if (c.ironLb > 0) d = Math.max(d, LEAD_DAYS.iron);
    return d;
  }

  private note(text: string) {
    this.log = [...this.log, { day: this.day, text }].slice(-30);
  }

  /** Advance one working day. */
  tick() {
    if (!this.env) return;
    this.day++;

    // Wages first; a crew that can't be paid is let go.
    if (this.money < this.dailyWages) {
      if (this.dailyWages > 0) this.note('Wages could not be met; the crews were paid off.');
      this.crews = { laborers: 0, masons: 0, millwrights: 0 };
    }
    this.money -= this.dailyWages;

    const free = { laborer: this.crews.laborers, mason: this.crews.masons, millwright: this.crews.millwrights };
    const hired = free.laborer + free.mason + free.millwright;
    const activeEarth: Rect[] = [];

    for (const job of this.jobs) {
      if (job.status === 'done') continue;
      const c = job.item.cost;

      // Order the materials once, when there's money for them.
      if (job.materialsDay === null) {
        const m = this.materialsCost(c);
        if (m > this.money) {
          job.status = 'waiting for money';
          continue;
        }
        this.money -= m;
        job.materialsDay = this.day + this.leadDays(c);
        if (m > 0) this.note(`Ordered stone, timber and iron for ${job.item.label}.`);
      }

      const rem = this.remaining(job);

      // Earthwork.
      if (rem.laborer > 1e-9) {
        if (!job.rect) {
          const e = this.env.earthwork(job.item);
          if (e && activeEarth.some((r) => overlaps(r, e.rect))) {
            job.status = 'waiting for the ground';
            continue;
          }
          if (e) {
            job.rect = e.rect;
            job.target = e.heights;
            job.original = this.env.field.extract(e.rect);
          }
        } else if (activeEarth.some((r) => overlaps(r, job.rect!))) {
          job.status = 'waiting for the ground';
          continue;
        }
        if (job.rect) activeEarth.push(job.rect);
        job.status = 'earthwork';
        const work = Math.min(free.laborer, rem.laborer);
        free.laborer -= work;
        job.done.laborer += work;
        this.shapeGround(job);
        if (this.remaining(job).laborer > 1e-9) continue;
      } else if (job.rect) {
        activeEarth.push(job.rect);
      }

      // Skilled work needs the materials on site.
      if (rem.mason > 1e-9 || rem.millwright > 1e-9) {
        if (this.day < (job.materialsDay ?? Infinity)) {
          job.status = 'waiting for materials';
          continue;
        }
        if (rem.mason > 1e-9) {
          job.status = 'masonry';
          const work = Math.min(free.mason, rem.mason);
          free.mason -= work;
          job.done.mason += work;
          // (The laborers who tend the masons are already in the job's laborer-days.)
          continue;
        }
        job.status = 'millwork';
        const work = Math.min(free.millwright, rem.millwright);
        free.millwright -= work;
        job.done.millwright += work;
        if (this.remaining(job).millwright > 1e-9) continue;
      }

      if (this.day < (job.materialsDay ?? 0)) {
        job.status = 'waiting for materials';
        continue;
      }
      job.status = 'done';
      this.note(`${job.item.label} finished.`);
      this.env.onComplete(job.item);
    }
    this.checkIdle(hired, free);
  }

  /** Tell the player once when crews are being paid with nothing to do. */
  private checkIdle(hired: number, free: { laborer: number; mason: number; millwright: number }) {
    const idle = hired > 0 && free.laborer + free.mason + free.millwright >= hired;
    if (idle && !this.idleNoted) this.note(`The crews are idle and still drawing $${this.dailyWages.toFixed(2)} a day.`);
    this.idleNoted = idle;
  }

  /** Blend the ground from where it was to where the plan wants it, by the share dug. */
  private shapeGround(job: Job) {
    if (!job.rect || !job.original || !job.target) return;
    const need = job.item.cost.laborerDays;
    const f = need > 0 ? Math.min(1, job.done.laborer / need) : 1;
    const { rect, original, target } = job;
    const w = rect.i1 - rect.i0;
    const H = this.env!.field.heights;
    const nx = this.env!.field.nx;
    for (let j = rect.j0; j < rect.j1; j++) {
      for (let i = rect.i0; i < rect.i1; i++) {
        const k = (j - rect.j0) * w + (i - rect.i0);
        H[j * nx + i] = original[k] + (target[k] - original[k]) * f;
      }
    }
    this.env!.onTerrain(rect);
  }

  /** Take finished jobs off the list. */
  clearDone() {
    this.jobs = this.jobs.filter((j) => j.status !== 'done');
  }
}
