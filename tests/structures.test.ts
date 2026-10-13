import { describe, expect, it } from 'vitest';
import { cellsInDisk, type Structure, structureLink, wheelHead } from '../src/mill/structures';
import { StructuresController, WORKING_HOURS } from '../src/mill/structuresController';
import { BREASTSHOT, runMill, SASH_SAW, wheelPower } from '../src/mill/wheel';
import type { SimStats } from '../src/water/protocol';

const grid = { nx: 100, nz: 80, dx: 0.5, x0: 0, z0: 0 };

function wheel(id: string, opening = 0.3): Structure {
  return {
    id,
    kind: 'wheel',
    name: id,
    intake: { x: 10, z: 10 },
    outlet: { x: 18, z: 10 },
    width: 2,
    sill: 1,
    opening,
    maxOpening: 0.6,
    lumber: 0,
  };
}

function stats(time: number, links: SimStats['links']): SimStats {
  return { time, volume: 0, inflow: 0, outflow: 0, spill: 0, pondLevel: 0, steps: 0, stepMs: 0, links };
}

describe('structure links', () => {
  it('intake and outlet cells are disks around the clicked points', () => {
    const cells = cellsInDisk(grid, 10, 10, 1);
    expect(cells.length).toBeGreaterThan(8);
    expect(cells.length).toBeLessThan(20);
    for (const c of cells) {
      const x = (c % grid.nx) * grid.dx + 0.25;
      const z = Math.floor(c / grid.nx) * grid.dx + 0.25;
      expect(Math.hypot(x - 10, z - 10)).toBeLessThanOrEqual(1);
    }
    // A point between cell centres still gets its own cell.
    expect(cellsInDisk(grid, 3.1, 3.1, 0.01).length).toBe(1);
  });

  it('wheels are capped at their bucket capacity; plain gates are not', () => {
    expect(structureLink(grid, wheel('w')).maxDischarge).toBe(BREASTSHOT.maxDischarge);
    expect(structureLink(grid, { ...wheel('g'), kind: 'gate' }).maxDischarge).toBe(Infinity);
    expect(structureLink(grid, wheel('w', 5)).opening).toBe(0.6); // clamped to max opening
  });
});

describe('StructuresController', () => {
  it('starts with the old mill and adds, adjusts and removes structures (not the built-in one)', () => {
    const c = new StructuresController();
    expect(c.structures).toHaveLength(1);
    expect(c.structures[0].builtIn).toBe(true);
    const sent: string[] = [];
    const removed: string[] = [];
    c.attach(grid, { setLink: (l) => sent.push(`${l.id}:${l.opening}`), removeLink: (id) => removed.push(id) });
    c.add(wheel('w1'));
    c.setOpening('w1', 0.5);
    expect(sent.at(-1)).toBe('w1:0.5');
    c.remove(c.structures[0].id);
    expect(c.structures).toHaveLength(2); // built-in mill can't be removed
    c.remove('w1');
    expect(removed).toEqual(['w1']);
    expect(c.structures).toHaveLength(1);
  });

  it('computes each wheel’s power from its link and credits lumber per working day', () => {
    const c = new StructuresController();
    c.restore([wheel('w1')]);
    const link = { id: 'w1', discharge: 1.2, etaFrom: 4, etaTo: 1 };
    c.update(stats(100, [link]), 1e9);
    const v = c.getSnapshot().structures[0];
    const expected = runMill(wheelPower(BREASTSHOT, 1.2, wheelHead(4, 1)), SASH_SAW);
    expect(v.wheelHp).toBeCloseTo(expected.wheelHp, 6);
    // Water-clock updates alone cut nothing: output follows the calendar.
    for (let t = 101; t < 200; t++) c.update(stats(t, [link]), 2e9 + t);
    expect(c.getSnapshot().structures[0].lumber).toBe(0);
    const cut = c.accrueDays(3);
    expect(cut).toBeCloseTo(expected.perHour * WORKING_HOURS * 3, 6);
    expect(c.getSnapshot().structures[0].lumber).toBeCloseTo(cut, 6);
    expect(c.getSnapshot().totalLumber).toBeCloseTo(cut, 6);
  });
});
