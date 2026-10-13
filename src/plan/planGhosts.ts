import { Group, type Line } from 'three';
import { polyline, setPolyline } from '../tools/pathView';
import type { TerrainField } from '../world/terrainField';
import { ghostLines, type PlanBook } from './planBook';

/** Draws every planned item as dashed "proposed work" outlines. */
export class PlanGhosts {
  readonly group = new Group();
  private lines: Line[] = [];
  private drawnVersion = -1;

  constructor(
    private readonly book: PlanBook,
    private readonly field: TerrainField,
  ) {}

  update() {
    if (this.book.version === this.drawnVersion) return;
    this.drawnVersion = this.book.version;
    const all = this.book.items.flatMap((i) => ghostLines(this.field, i.input));
    while (this.lines.length < all.length) {
      const l = polyline(64, true);
      this.lines.push(l);
      this.group.add(l);
    }
    this.lines.forEach((l, k) => {
      l.visible = k < all.length && all[k].length > 1;
      if (l.visible) setPolyline(l, all[k]);
    });
  }
}
