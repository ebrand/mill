import { BufferAttribute, BufferGeometry, Group, type Material as ThreeMaterial, Mesh, Sphere, Vector3 } from 'three';
import type { Rect, TerrainField } from './terrainField';

/**
 * The terrain drawn as a grid of chunks, so an edit only rebuilds the chunks it touches.
 * Vertices sit on the field's samples. Normals come from the field (central differences),
 * not from each chunk's triangles, so neighbouring chunks agree along their shared edge.
 */
export class TerrainMeshes {
  readonly group = new Group();
  private readonly chunks: { mesh: Mesh; i0: number; j0: number; i1: number; j1: number }[] = [];

  constructor(
    private readonly field: TerrainField,
    material: ThreeMaterial,
    readonly chunkSize = 64,
  ) {
    const { nx, nz } = field;
    for (let j0 = 0; j0 < nz - 1; j0 += chunkSize) {
      for (let i0 = 0; i0 < nx - 1; i0 += chunkSize) {
        // Chunks overlap by one sample so there's no gap between them.
        const i1 = Math.min(i0 + chunkSize, nx - 1);
        const j1 = Math.min(j0 + chunkSize, nz - 1);
        const geometry = this.buildGeometry(i0, j0, i1, j1);
        const mesh = new Mesh(geometry, material);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        this.chunks.push({ mesh, i0, j0, i1, j1 });
        this.group.add(mesh);
      }
    }
  }

  get chunkCount(): number {
    return this.chunks.length;
  }

  private buildGeometry(i0: number, j0: number, i1: number, j1: number): BufferGeometry {
    const w = i1 - i0 + 1;
    const h = j1 - j0 + 1;
    const positions = new Float32Array(w * h * 3);
    const normals = new Float32Array(w * h * 3);
    const ground = new Float32Array(w * h);
    const indices = new Uint32Array((w - 1) * (h - 1) * 6);
    let k = 0;
    for (let j = 0; j < h - 1; j++) {
      for (let i = 0; i < w - 1; i++) {
        const a = j * w + i;
        indices.set([a, a + w, a + 1, a + 1, a + w, a + w + 1], k);
        k += 6;
      }
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(positions, 3));
    g.setAttribute('normal', new BufferAttribute(normals, 3));
    g.setAttribute('ground', new BufferAttribute(ground, 1));
    g.setIndex(new BufferAttribute(indices, 1));
    this.fill(g, i0, j0, i1, j1);
    return g;
  }

  /** Write heights, normals and material for a chunk from the field. */
  private fill(g: BufferGeometry, i0: number, j0: number, i1: number, j1: number) {
    const f = this.field;
    const w = i1 - i0 + 1;
    const pos = g.getAttribute('position') as BufferAttribute;
    const nor = g.getAttribute('normal') as BufferAttribute;
    const gr = g.getAttribute('ground') as BufferAttribute;
    const H = f.heights;
    const nx = f.nx;
    const n = new Vector3();
    let minY = Infinity;
    let maxY = -Infinity;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const v = (j - j0) * w + (i - i0);
        const k = j * nx + i;
        const y = H[k];
        pos.setXYZ(v, f.sampleX(i), y, f.sampleZ(j));
        const hl = H[j * nx + Math.max(i - 1, 0)];
        const hr = H[j * nx + Math.min(i + 1, nx - 1)];
        const hd = H[Math.max(j - 1, 0) * nx + i];
        const hu = H[Math.min(j + 1, f.nz - 1) * nx + i];
        n.set(hl - hr, 2 * f.dx, hd - hu).normalize();
        nor.setXYZ(v, n.x, n.y, n.z);
        gr.setX(v, f.material[k]);
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    pos.needsUpdate = true;
    nor.needsUpdate = true;
    gr.needsUpdate = true;
    const cx = (f.sampleX(i0) + f.sampleX(i1)) / 2;
    const cz = (f.sampleZ(j0) + f.sampleZ(j1)) / 2;
    const half = ((i1 - i0) * f.dx) / 2;
    const halfZ = ((j1 - j0) * f.dx) / 2;
    g.boundingSphere = new Sphere(new Vector3(cx, (minY + maxY) / 2, cz), Math.hypot(half, halfZ, (maxY - minY) / 2));
  }

  /** Rebuild every chunk that overlaps `rect` (grown by one sample for normals). */
  update(rect: Rect): number {
    const r = { i0: rect.i0 - 1, j0: rect.j0 - 1, i1: rect.i1 + 1, j1: rect.j1 + 1 };
    let rebuilt = 0;
    for (const c of this.chunks) {
      if (c.i1 < r.i0 || c.i0 >= r.i1 || c.j1 < r.j0 || c.j0 >= r.j1) continue;
      this.fill(c.mesh.geometry, c.i0, c.j0, c.i1, c.j1);
      rebuilt++;
    }
    return rebuilt;
  }

  /** For tests: the height a chunk's vertex holds at sample (i, j), from every chunk containing it. */
  heightsAt(i: number, j: number): number[] {
    const out: number[] = [];
    for (const c of this.chunks) {
      if (i < c.i0 || i > c.i1 || j < c.j0 || j > c.j1) continue;
      const w = c.i1 - c.i0 + 1;
      const pos = c.mesh.geometry.getAttribute('position') as BufferAttribute;
      out.push(pos.getY((j - c.j0) * w + (i - c.i0)));
    }
    return out;
  }
}
