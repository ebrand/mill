import { BufferAttribute, BufferGeometry, Color, Mesh } from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import type { TerrainGrid } from './terrain';

const SAND = new Color(0.76, 0.68, 0.5);
const WET_SAND = new Color(0.55, 0.47, 0.33);
const SEABED = new Color(0.62, 0.58, 0.45);
const GRASS = new Color(0.24, 0.42, 0.16);
const ROCK = new Color(0.36, 0.34, 0.31);

export function createTerrainMesh(grid: TerrainGrid): Mesh {
  const n = grid.resolution;
  const step = grid.size / (n - 1);
  const half = grid.size / 2;
  const positions = new Float32Array(n * n * 3);
  const colors = new Float32Array(n * n * 3);
  const c = new Color();

  const h = (ix: number, iz: number) =>
    grid.heights[Math.min(n - 1, Math.max(0, iz)) * n + Math.min(n - 1, Math.max(0, ix))];

  for (let iz = 0; iz < n; iz++) {
    for (let ix = 0; ix < n; ix++) {
      const i = iz * n + ix;
      const y = h(ix, iz);
      positions[i * 3] = -half + ix * step;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = -half + iz * step;

      const slope = Math.hypot(h(ix + 1, iz) - h(ix - 1, iz), h(ix, iz + 1) - h(ix, iz - 1)) / (2 * step);
      if (y < -0.3) c.copy(SEABED).lerp(WET_SAND, Math.max(0, Math.min(1, (y + 3) / 3)));
      else if (y < 1.2) c.copy(WET_SAND).lerp(SAND, Math.min(1, (y + 0.3) / 0.8));
      else c.copy(SAND).lerp(GRASS, Math.min(1, (y - 1.2) / 1.5));
      if (y > 0) c.lerp(ROCK, Math.max(0, Math.min(1, (slope - 0.55) / 0.35)));
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
  }

  const indices = new Uint32Array((n - 1) * (n - 1) * 6);
  let k = 0;
  for (let iz = 0; iz < n - 1; iz++) {
    for (let ix = 0; ix < n - 1; ix++) {
      const a = iz * n + ix;
      indices[k++] = a;
      indices[k++] = a + n;
      indices[k++] = a + 1;
      indices[k++] = a + 1;
      indices[k++] = a + n;
      indices[k++] = a + n + 1;
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  geometry.setIndex(new BufferAttribute(indices, 1));
  geometry.computeVertexNormals();

  const material = new MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
  const mesh = new Mesh(geometry, material);
  mesh.receiveShadow = true;
  return mesh;
}
