import { BufferAttribute, BufferGeometry, type DataTexture, Mesh } from 'three';
import {
  clamp,
  dot,
  float,
  floor,
  fract,
  Fn,
  fwidth,
  If,
  length,
  Loop,
  max,
  mix,
  mx_noise_float,
  normalize,
  positionLocal,
  positionWorld,
  sin,
  smoothstep,
  texture,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
  Discard,
} from 'three/tsl';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { lineFamily, type Node } from '../ink/hatching';
import { inkTime } from '../ink/materials';
import type { GridInfo } from './protocol';

/** Grid of vertices at the sim's cell centers, with uv addressing the state texture. */
function gridGeometry(grid: GridInfo): BufferGeometry {
  const { nx, nz, dx, x0, z0 } = grid;
  const positions = new Float32Array(nx * nz * 3);
  const uvs = new Float32Array(nx * nz * 2);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      positions[k * 3] = x0 + (i + 0.5) * dx;
      positions[k * 3 + 2] = z0 + (j + 0.5) * dx;
      uvs[k * 2] = (i + 0.5) / nx;
      uvs[k * 2 + 1] = (j + 0.5) / nz;
    }
  }
  const indices = new Uint32Array((nx - 1) * (nz - 1) * 6);
  let o = 0;
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i;
      indices.set([a, a + nx, a + 1, a + 1, a + nx, a + nx + 1], o);
      o += 6;
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(positions, 3));
  g.setAttribute('uv', new BufferAttribute(uvs, 2));
  g.setIndex(new BufferAttribute(indices, 1));
  return g;
}

function hash(c: Node): Node {
  return fract(sin(dot(c, vec2(12.9898, 78.233))).mul(43758.5453));
}

/**
 * Water drawn from the sim: the surface follows the simulated height, and flow lines come
 * from line integral convolution over the simulated velocity field.
 */
export function createWaterSurface(grid: GridInfo, state: DataTexture) {
  const size = vec2(grid.nx * grid.dx, grid.nz * grid.dx);
  const origin = vec2(grid.x0, grid.z0);
  const toUV = (p: Node) => p.sub(origin).div(size);
  const sample = (p: Node) => texture(state, toUV(p)).level(float(0));

  const material = new MeshBasicNodeMaterial();
  material.positionNode = vec3(positionLocal.x, texture(state, uv()).level(float(0)).x, positionLocal.z);

  /** Tunables, exposed for live adjustment from the dev console. */
  const params = {
    stepLength: uniform(0.2),
    spotSpacing: uniform(0.85),
    /** Stroke half-width in pixels, so lines stay pen-thin at any zoom. */
    strokePx: uniform(1.1),
    threshold: uniform(0.35),
  };
  const STEPS = 10;

  /**
   * Coverage of the dot in q's cell by the trace segment a->b. Testing the segment (not
   * just a point) means thin dots aren't skipped between steps.
   */
  const spot = (a: Node, b: Node, radius: Node) => {
    const mid = a.add(b).mul(0.5);
    const cell = floor(mid.div(params.spotSpacing));
    const offset = vec2(hash(cell), hash(cell.add(vec2(17.1, 3.7)))).mul(0.6).add(0.2);
    const present = smoothstep(0.45, 0.5, hash(cell.add(vec2(5.3, 41.9))));
    const center = cell.add(offset).mul(params.spotSpacing);
    const ab = b.sub(a);
    const t = clamp(dot(center.sub(a), ab).div(max(dot(ab, ab), 1e-6)), 0, 1);
    const d = length(center.sub(a.add(ab.mul(t))));
    return smoothstep(radius, radius.mul(0.5), d).mul(present);
  };

  material.outputNode = Fn(() => {
    const p = positionWorld.xz;
    const here = sample(p);
    Discard(here.y.lessThan(-0.5));

    const vel = here.zw;
    const speed = length(vel);

    const metersPerPx = max(fwidth(p.x), fwidth(p.y));
    const radius = metersPerPx.mul(params.strokePx);

    // Trace the streamline both ways, accumulating sparse dots weighted by a moving
    // window so the strokes travel downstream.
    const accum = float(0).toVar();
    for (const sign of [1, -1]) {
      const q = vec2(p).toVar();
      Loop(STEPS, ({ i }: { i: Node }) => {
        const v = sample(q).zw;
        const next = vec2(q).toVar();
        If(length(v).greaterThan(0.02), () => {
          next.assign(q.add(normalize(v).mul(params.stepLength).mul(sign)));
        });
        const s = float(i).add(0.5).mul(params.stepLength).mul(sign);
        const window = sin(s.mul(1.3).sub(inkTime.mul(max(speed, 0.2)).mul(1.3))).mul(0.5).add(0.5);
        accum.addAssign(spot(q, next, radius).mul(window));
        q.assign(next);
      });
    }
    // Strokes thinner than a pixel shimmer, so fade flow lines out with distance.
    const legible = smoothstep(0.12, 0.04, metersPerPx);
    const flowInk = smoothstep(params.threshold, params.threshold.mul(1.4), accum).mul(legible);

    // Still water: the broken horizontal dashes from M0.
    const rows = lineFamily(p, vec2(0, 1), { base: 0.7, targetPx: 9, widthPx: 0.8 });
    const dash = smoothstep(0.62, 0.5, fract(p.x.div(3.1).add(mx_noise_float(vec3(p.x, 0, p.y).mul(0.35)).mul(1.3))));
    const stillInk = rows.mul(dash);

    const moving = smoothstep(0.04, 0.2, speed);
    const ink = clamp(mix(stillInk, max(flowInk, stillInk.mul(0.3)), moving), 0, 1).mul(0.85);
    // x: ink, y: tone, z: surface id (water = 1), w: shadow wash (none yet on water).
    return vec4(ink, 1, 1, 0);
  })();

  const mesh = new Mesh(gridGeometry(grid), material);
  mesh.frustumCulled = false;
  return { mesh, params };
}
