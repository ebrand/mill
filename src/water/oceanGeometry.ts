import { BufferAttribute, BufferGeometry } from 'three';

/**
 * Square grid in the XZ plane whose vertex spacing grows exponentially from the center,
 * so one mesh covers the horizon while staying dense near the camera.
 */
export function createOceanGeometry(segments = 384, radius = 4000, growth = 6): BufferGeometry {
  const n = segments + 1;
  const coords = new Float32Array(n);
  const denom = Math.exp(growth) - 1;
  for (let i = 0; i < n; i++) {
    const u = (i / segments) * 2 - 1;
    coords[i] = (Math.sign(u) * radius * (Math.exp(growth * Math.abs(u)) - 1)) / denom;
  }

  const positions = new Float32Array(n * n * 3);
  for (let iz = 0; iz < n; iz++) {
    for (let ix = 0; ix < n; ix++) {
      const o = (iz * n + ix) * 3;
      positions[o] = coords[ix];
      positions[o + 1] = 0;
      positions[o + 2] = coords[iz];
    }
  }

  const indices = new Uint32Array(segments * segments * 6);
  let k = 0;
  for (let iz = 0; iz < segments; iz++) {
    for (let ix = 0; ix < segments; ix++) {
      const a = iz * n + ix;
      const b = a + 1;
      const c = a + n;
      const d = c + 1;
      // Counter-clockwise when viewed from +Y.
      indices[k++] = a;
      indices[k++] = c;
      indices[k++] = b;
      indices[k++] = b;
      indices[k++] = c;
      indices[k++] = d;
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setIndex(new BufferAttribute(indices, 1));
  // The surface moves in the vertex shader; never cull it.
  geometry.boundingSphere = null;
  return geometry;
}

/** Spacing between the two innermost vertices, used to snap the grid without swimming. */
export function centerSpacing(segments = 384, radius = 4000, growth = 6): number {
  const u = 2 / segments;
  return (radius * (Math.exp(growth * u) - 1)) / (Math.exp(growth) - 1);
}
