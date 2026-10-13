import { describe, expect, it } from 'vitest';
import type { Structure } from '../src/mill/structures';
import { estimate, ghostLines, PlanBook } from '../src/plan/planBook';
import { applyChannel, type ChannelPlan, DEFAULT_PLAN, planChannel } from '../src/tools/channel';
import { DEFAULT_EMBANKMENT } from '../src/tools/embankment';
import { Material, TerrainField } from '../src/world/terrainField';

function field() {
  const f = new TerrainField({ nx: 240, nz: 80, dx: 0.5, x0: 0, z0: 0 });
  f.generate((x) => 3 - 0.01 * x, (x) => (x > 80 && x < 90 ? Material.Rock : Material.Soil));
  return f;
}

const race: ChannelPlan = { ...DEFAULT_PLAN, startBed: 1.5, points: [{ x: 10, z: 20 }, { x: 70, z: 20 }] };
const wheel: Structure = {
  id: 'w', kind: 'wheel', name: 'w', intake: { x: 70, z: 20 }, outlet: { x: 82, z: 20 }, width: 2.2, sill: 1.5,
  opening: 0.3, maxOpening: 0.6, lumber: 0, pit: { start: 3.5, floor: -1, radius: 1.8 },
};

describe('works plan', () => {
  it('estimates each kind of work; planning never touches the ground', () => {
    const f = field();
    const before = f.heights.slice();
    const r = estimate(f, { kind: 'channel', plan: race });
    expect(r.cutYd3).toBeGreaterThan(50);
    expect(r.dollars).toBeGreaterThan(0);
    const b = estimate(f, { kind: 'bank', plan: { ...DEFAULT_EMBANKMENT, crest: 4, points: [{ x: 20, z: 5 }, { x: 20, z: 35 }] } });
    expect(b.fillYd3).toBeGreaterThan(10);
    const w = estimate(f, { kind: 'structure', structure: wheel });
    expect(w.timberBf).toBeGreaterThan(1000);
    expect(w.cutYd3).toBeGreaterThan(5); // its pit
    expect(f.heights).toEqual(before);
  });

  it('builds through the scene’s executor, recosts what remains, and restores', () => {
    const f = field();
    const book = new PlanBook();
    const built: string[] = [];
    book.env = {
      field: f,
      build: (item) => {
        built.push(item.label);
        if (item.input.kind === 'channel') applyChannel(f, planChannel(f, item.input.plan));
        return true;
      },
    };
    const a = book.add({ kind: 'channel', plan: race })!;
    // A second, parallel race that overlaps the first: cheaper once the first is dug.
    const overlap: ChannelPlan = { ...race, points: [{ x: 10, z: 21 }, { x: 70, z: 21 }] };
    const b = book.add({ kind: 'channel', plan: overlap })!;
    const costBefore = book.getSnapshot().items[1].cost.dollars;
    expect(book.getSnapshot().total.dollars).toBeCloseTo(a.cost.dollars + b.cost.dollars, 6);
    expect(book.build(a.id)).toBe(true);
    expect(built).toEqual(['Race 1']);
    expect(book.items).toHaveLength(1);
    expect(book.getSnapshot().items[0].cost.dollars).toBeLessThan(costBefore);
    const saved = book.items.map((i) => ({ ...i }));
    const fresh = new PlanBook();
    fresh.env = book.env;
    fresh.restore(saved);
    expect(fresh.items.map((i) => i.label)).toEqual(['Race 2']);
    // Numbering is per kind and continues past restored items.
    expect(book.add({ kind: 'structure', structure: wheel })!.label).toBe('Wheel 1');
    expect(fresh.add({ kind: 'channel', plan: race })!.label).toBe('Race 3');
    // Names already used by jobs or structures aren't reused.
    fresh.env = { ...book.env!, usedLabels: () => ['Race 4', 'Race 5'] };
    expect(fresh.add({ kind: 'channel', plan: race })!.label).toBe('Race 6');
  });

  it('draws ghosts: two edges for races and banks, ends and pit outline for a wheel', () => {
    const f = field();
    expect(ghostLines(f, { kind: 'channel', plan: race })).toHaveLength(2);
    const lines = ghostLines(f, { kind: 'structure', structure: wheel });
    expect(lines).toHaveLength(4);
    for (const line of lines) for (const p of line) expect(Number.isFinite(p[1])).toBe(true);
  });
});
