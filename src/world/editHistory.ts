// Undo/redo for terrain edits. An edit saves the original heights of each tile it touches,
// once, just before the first change to that tile, so a long brush stroke costs no more
// than the area it covers. Undo captures the current tiles so redo can put them back.

import { type Rect, type TerrainField, unionRect } from './terrainField';

export const TILE = 64;

/** Running totals of earth moved, m^3. */
export class EarthLedger {
  cut = 0;
  fill = 0;
}

interface Edit {
  label: string;
  /** Tile key -> heights of that tile before the edit. */
  before: Map<number, Float32Array>;
  /** Filled in on undo: heights after the edit, for redo. */
  after: Map<number, Float32Array> | null;
  cut: number;
  fill: number;
}

export class EditHistory {
  private done: Edit[] = [];
  private undone: Edit[] = [];
  private current: Edit | null = null;
  private readonly tilesX: number;

  constructor(
    private readonly field: TerrainField,
    readonly ledger: EarthLedger,
    readonly maxSteps = 50,
  ) {
    this.tilesX = Math.ceil(field.nx / TILE);
  }

  get canUndo(): boolean {
    return this.done.length > 0 && !this.current;
  }
  get canRedo(): boolean {
    return this.undone.length > 0 && !this.current;
  }
  get undoLabel(): string | null {
    return this.done.at(-1)?.label ?? null;
  }
  get redoLabel(): string | null {
    return this.undone.at(-1)?.label ?? null;
  }

  begin(label: string): void {
    if (this.current) this.end();
    this.current = { label, before: new Map(), after: null, cut: 0, fill: 0 };
  }

  /** Call before changing anything inside `rect`. */
  touch(rect: Rect): void {
    const e = this.current;
    if (!e) throw new Error('touch() outside begin()/end()');
    for (const key of this.tilesIn(rect)) {
      if (!e.before.has(key)) e.before.set(key, this.copyTile(key));
    }
  }

  /** Record earth moved by the current edit (also added to the ledger). */
  record(cut: number, fill: number): void {
    if (!this.current) return;
    this.current.cut += cut;
    this.current.fill += fill;
    this.ledger.cut += cut;
    this.ledger.fill += fill;
  }

  end(): void {
    const e = this.current;
    this.current = null;
    if (!e || e.before.size === 0) return;
    this.done.push(e);
    if (this.done.length > this.maxSteps) this.done.shift();
    this.undone = [];
  }

  /** Revert the last edit. Returns the changed rectangle, or null if there was nothing to undo. */
  undo(): Rect | null {
    if (!this.canUndo) return null;
    const e = this.done.pop()!;
    e.after = new Map();
    let rect: Rect | null = null;
    for (const [key, heights] of e.before) {
      e.after.set(key, this.copyTile(key));
      rect = unionRect(rect, this.writeTile(key, heights));
    }
    this.ledger.cut -= e.cut;
    this.ledger.fill -= e.fill;
    this.undone.push(e);
    return rect;
  }

  redo(): Rect | null {
    if (!this.canRedo) return null;
    const e = this.undone.pop()!;
    let rect: Rect | null = null;
    for (const [key, heights] of e.after!) rect = unionRect(rect, this.writeTile(key, heights));
    this.ledger.cut += e.cut;
    this.ledger.fill += e.fill;
    this.done.push(e);
    return rect;
  }

  clear(): void {
    this.done = [];
    this.undone = [];
    this.current = null;
  }

  private tileRect(key: number): Rect {
    const tx = key % this.tilesX;
    const tz = Math.floor(key / this.tilesX);
    return {
      i0: tx * TILE,
      j0: tz * TILE,
      i1: Math.min((tx + 1) * TILE, this.field.nx),
      j1: Math.min((tz + 1) * TILE, this.field.nz),
    };
  }

  private *tilesIn(rect: Rect): Generator<number> {
    const tx0 = Math.max(0, Math.floor(rect.i0 / TILE));
    const tz0 = Math.max(0, Math.floor(rect.j0 / TILE));
    const tx1 = Math.min(this.tilesX - 1, Math.floor((rect.i1 - 1) / TILE));
    const tz1 = Math.min(Math.ceil(this.field.nz / TILE) - 1, Math.floor((rect.j1 - 1) / TILE));
    for (let tz = tz0; tz <= tz1; tz++) for (let tx = tx0; tx <= tx1; tx++) yield tz * this.tilesX + tx;
  }

  private copyTile(key: number): Float32Array {
    return this.field.extract(this.tileRect(key));
  }

  private writeTile(key: number, heights: Float32Array): Rect {
    const r = this.tileRect(key);
    const w = r.i1 - r.i0;
    for (let j = r.j0; j < r.j1; j++) this.field.heights.set(heights.subarray((j - r.j0) * w, (j - r.j0 + 1) * w), j * this.field.nx + r.i0);
    return r;
  }
}
