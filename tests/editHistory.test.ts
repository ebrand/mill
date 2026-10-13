import { describe, expect, it } from 'vitest';
import { EarthLedger, EditHistory } from '../src/world/editHistory';
import { Material, type Rect, TerrainField } from '../src/world/terrainField';

function setup() {
  const f = new TerrainField({ nx: 200, nz: 150, dx: 0.5, x0: 0, z0: 0 });
  f.generate((x, z) => Math.sin(x * 0.1) + Math.cos(z * 0.07), () => Material.Soil);
  const ledger = new EarthLedger();
  return { f, ledger, h: new EditHistory(f, ledger) };
}

/** A brush stroke the way the tool does it: touch the brush's bounds, then edit. */
function stroke(h: EditHistory, f: TerrainField, pts: [number, number][], amount: number) {
  h.begin('stroke');
  for (const [x, z] of pts) {
    const r = 3;
    const rect: Rect = {
      i0: Math.max(0, Math.floor((x - r) / f.dx) - 1),
      j0: Math.max(0, Math.floor((z - r) / f.dx) - 1),
      i1: Math.min(f.nx, Math.ceil((x + r) / f.dx) + 1),
      j1: Math.min(f.nz, Math.ceil((z + r) / f.dx) + 1),
    };
    h.touch(rect);
    const e = f.brush(x, z, r, amount);
    h.record(e.cut, e.fill);
  }
  h.end();
}

describe('EditHistory', () => {
  it('undo restores the terrain exactly, redo reapplies it exactly, across tile borders', () => {
    const { f, ledger, h } = setup();
    const original = f.heights.slice();
    // A stroke crossing the tile boundary at sample 64 (x = 32 m) in both directions.
    stroke(h, f, [[28, 28], [32, 32], [36, 36]], -0.5);
    const edited = f.heights.slice();
    expect(edited).not.toEqual(original);
    expect(ledger.cut).toBeGreaterThan(0);

    const rect = h.undo();
    expect(rect).not.toBeNull();
    expect(f.heights).toEqual(original);
    expect(ledger.cut).toBeCloseTo(0, 9);

    h.redo();
    expect(f.heights).toEqual(edited);
    expect(ledger.cut).toBeGreaterThan(0);
  });

  it('undoes several edits in reverse order and a new edit clears redo', () => {
    const { f, h } = setup();
    const s0 = f.heights.slice();
    stroke(h, f, [[10, 10]], -0.3);
    const s1 = f.heights.slice();
    stroke(h, f, [[60, 40]], 0.4);
    h.undo();
    expect(f.heights).toEqual(s1);
    h.undo();
    expect(f.heights).toEqual(s0);
    expect(h.canUndo).toBe(false);
    h.redo();
    expect(f.heights).toEqual(s1);
    stroke(h, f, [[80, 20]], -0.2);
    expect(h.canRedo).toBe(false);
  });

  it('only stores tiles an edit touched', () => {
    const { f, h } = setup();
    stroke(h, f, [[10, 10]], -0.3);
    // One 64x64 tile at 0.5 m is 32 m square; a radius-3 brush at (10, 10) stays in tile 0.
    const internal = (h as unknown as { done: { before: Map<number, unknown> }[] }).done;
    expect(internal[0].before.size).toBe(1);
  });

  it('drops the oldest steps beyond the limit', () => {
    const { f, ledger } = setup();
    const h = new EditHistory(f, ledger, 3);
    for (let k = 0; k < 5; k++) stroke(h, f, [[10 + k * 5, 10]], -0.1);
    let undos = 0;
    while (h.undo()) undos++;
    expect(undos).toBe(3);
  });
});
