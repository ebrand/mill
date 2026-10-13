import { describe, expect, it } from 'vitest';
import { Construction, LEAD_DAYS } from '../src/build/construction';
import { emptyCost, priced, RATES } from '../src/plan/costs';
import type { PlanItem } from '../src/plan/planBook';
import { Material, type Rect, TerrainField } from '../src/world/terrainField';

function field() {
  const f = new TerrainField({ nx: 80, nz: 40, dx: 0.5, x0: 0, z0: 0 });
  f.generate(() => 2, () => Material.Soil);
  return f;
}

/** A plan item with given trade-days and materials; its earthwork lowers a box by 1 m. */
function item(label: string, cost: Partial<ReturnType<typeof emptyCost>>, box: Rect | null): PlanItem & { box: Rect | null } {
  const c = priced({ ...emptyCost(), ...cost });
  return { id: label, label, input: { kind: 'channel', plan: null as never }, cost: c, box };
}

function site(startMoney = 1000) {
  const f = field();
  const completed: string[] = [];
  const changed: Rect[] = [];
  const cons = new Construction(
    {
      field: f,
      earthwork: (it) => {
        const box = (it as PlanItem & { box: Rect | null }).box;
        if (!box) return null;
        const h = f.extract(box);
        for (let k = 0; k < h.length; k++) h[k] -= 1;
        return { rect: box, heights: h };
      },
      onTerrain: (r) => changed.push(r),
      onComplete: (it) => completed.push(it.label),
    },
    startMoney,
  );
  return { f, cons, completed, changed };
}

describe('construction', () => {
  it('earthwork progresses with the crew and lands exactly on the plan', () => {
    const { f, cons, completed } = site();
    const box = { i0: 10, j0: 10, i1: 20, j1: 20 };
    cons.enqueue(item('Race', { laborerDays: 50 }, box));
    cons.crews.laborers = 10;
    for (let d = 0; d < 2; d++) cons.tick();
    // Two days of ten men = 20 of 50 laborer-days: 40% of the way down.
    expect(f.heights[15 * f.nx + 15]).toBeCloseTo(2 - 0.4, 5);
    expect(cons.jobs[0].status).toBe('earthwork');
    for (let d = 0; d < 3; d++) cons.tick();
    expect(f.heights[15 * f.nx + 15]).toBeCloseTo(1, 5);
    expect(completed).toEqual(['Race']);
    expect(f.heights[5 * f.nx + 5]).toBe(2); // outside the works, untouched
  });

  it('pays wages every day, idle or not, and lets the crew go when it can’t', () => {
    const { cons } = site(10);
    cons.crews = { laborers: 5, masons: 0, millwrights: 0 };
    cons.tick();
    expect(cons.money).toBeCloseTo(10 - 5 * RATES.laborerWage, 9);
    for (let d = 0; d < 5; d++) cons.tick();
    expect(cons.crews.laborers).toBe(0);
    expect(cons.log.some((l) => l.text.includes('paid off'))).toBe(true);
  });

  it('skilled work waits for materials, then masonry before millwork', () => {
    const { cons, completed } = site(5000);
    cons.enqueue(item('Wheel', { laborerDays: 4, masonDays: 2, millwrightDays: 4, stoneYd3: 3, timberBf: 4000, ironLb: 100 }, null));
    cons.crews = { laborers: 2, masons: 1, millwrights: 2 };
    const statuses: string[] = [];
    for (let d = 0; d < 20 && !completed.length; d++) {
      cons.tick();
      statuses.push(cons.jobs[0].status);
    }
    expect(statuses[0]).toBe('earthwork');
    expect(statuses).toContain('waiting for materials');
    const firstMasonry = statuses.indexOf('masonry');
    const firstMill = statuses.indexOf('millwork');
    expect(firstMasonry).toBeGreaterThanOrEqual(LEAD_DAYS.iron - 1);
    expect(firstMill).toBeGreaterThan(firstMasonry);
    expect(completed).toEqual(['Wheel']);
  });

  it('a job waits for money to buy its materials', () => {
    const { cons } = site(5);
    cons.enqueue(item('Gate', { millwrightDays: 1, timberBf: 1000 }, null)); // $8 of timber
    cons.tick();
    expect(cons.jobs[0].status).toBe('waiting for money');
    cons.money += 100;
    cons.tick();
    expect(cons.jobs[0].materialsDay).not.toBeNull();
  });

  it('overlapping earthworks are done one after the other', () => {
    const { f, cons, completed } = site();
    const a = { i0: 10, j0: 10, i1: 20, j1: 20 };
    const b = { i0: 15, j0: 10, i1: 25, j1: 20 }; // overlaps a
    cons.enqueue(item('A', { laborerDays: 10 }, a));
    cons.enqueue(item('B', { laborerDays: 10 }, b));
    cons.crews.laborers = 30;
    cons.tick();
    expect(cons.jobs[0].status).toBe('done');
    expect(cons.jobs[1].status).toBe('waiting for the ground');
    cons.tick();
    expect(completed).toEqual(['A', 'B']);
    // B started from A's finished ground, so the overlap went down twice.
    expect(f.heights[15 * f.nx + 17]).toBeCloseTo(0, 5);
  });
});
