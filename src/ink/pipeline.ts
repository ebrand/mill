import type { Camera, Scene } from 'three';
import { Color, Vector3 } from 'three';
import {
  abs,
  cameraFar,
  cameraNear,
  clamp,
  dot,
  float,
  Fn,
  max,
  mix,
  mrt,
  mx_noise_float,
  normalView,
  output,
  packNormalToRGB,
  pass,
  perspectiveDepthToViewZ,
  screenSize,
  screenUV,
  smoothstep,
  uniform,
  unpackRGBToNormal,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import { RenderPipeline, type WebGPURenderer } from 'three/webgpu';
import type { Node } from './hatching';

export const PAPER = new Color('#f1e9d8');
export const INK = new Color('#2b2620');
/** Colour of a fully shadowed area: a diluted ink wash over the paper. */
export const WASH = new Color('#a89d8a');

/**
 * Render the scene into ink coverage + normals + depth, then draw outlines from depth and
 * normal discontinuities and lay everything over paper.
 */
export function createInkPipeline(renderer: WebGPURenderer, scene: Scene, camera: Camera) {
  const scenePass = pass(scene, camera);
  scenePass.setMRT(mrt({ output, normal: packNormalToRGB(normalView) }));

  const inkTex = scenePass.getTextureNode('output');
  const normalTex = scenePass.getTextureNode('normal');
  const depthTex = scenePass.getTextureNode('depth');

  const edgesOn = uniform(1);
  const hatchOn = uniform(1);
  /** Debug view: show the lit tone value as grey instead of ink. */
  const showTone = uniform(0);
  const paper = uniform(PAPER);
  const ink = uniform(INK);
  // Wash as a multiplier on the paper, so paper grain shows through the shadow.
  const wash = uniform(new Vector3(WASH.r / PAPER.r, WASH.g / PAPER.g, WASH.b / PAPER.b));

  const viewDepth = (uv: Node) => perspectiveDepthToViewZ(depthTex.sample(uv).x, cameraNear, cameraFar).negate();
  const normalAt = (uv: Node) => unpackRGBToNormal(normalTex.sample(uv).xyz);
  // Materials write a surface id into output.z (water = 1) so shorelines get a line even
  // where land and water are both flat.
  const idAt = (uv: Node) => inkTex.sample(uv).z;

  const outline = Fn(() => {
    const texel = vec2(1, 1).div(screenSize);
    // Slight static jitter so outlines aren't machine-perfect.
    const jitter = vec2(mx_noise_float(vec3(screenUV.mul(180), 0)), mx_noise_float(vec3(screenUV.mul(180), 7))).mul(texel).mul(0.8);
    const uv = screenUV.add(jitter);
    const d0 = viewDepth(uv);
    const n0 = normalAt(uv);
    const id0 = idAt(uv);
    let edge: Node = float(0);
    const offsets: [number, number][] = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    for (const [ox, oy] of offsets) {
      const o = uv.add(texel.mul(vec2(ox, oy)).mul(1.2));
      const d = viewDepth(o);
      // Relative depth jump: scale-free, so near and far silhouettes behave alike.
      const depthEdge = smoothstep(0.012, 0.03, abs(d.sub(d0)).div(max(d0, 0.001)));
      const normalEdge = smoothstep(0.12, 0.3, float(1).sub(dot(normalAt(o), n0)));
      const idEdge = smoothstep(0.3, 0.6, abs(idAt(o).sub(id0)));
      edge = max(edge, max(max(depthEdge, normalEdge), idEdge));
    }
    return edge;
  });

  const composite = Fn(() => {
    const data = inkTex.sample(screenUV);
    const depth = viewDepth(screenUV);
    const background = depthTex.sample(screenUV).x.greaterThanEqual(0.99999);
    const surfaceInk = data.x.mul(hatchOn);
    const edge = outline().mul(edgesOn);
    // Distant ground is drawn lighter, as an illustrator would.
    const distanceFade = mix(float(1), float(0.45), smoothstep(180, 700, depth));
    const amount = background.select(float(0), clamp(max(surfaceInk, edge.mul(0.95)), 0, 1).mul(distanceFade));
    const grain = mx_noise_float(vec3(screenUV.mul(screenSize).mul(0.35), 3)).mul(0.035);
    const fibers = mx_noise_float(vec3(screenUV.mul(screenSize).mul(vec2(0.02, 0.2)), 11)).mul(0.02);
    const paperColor = paper.mul(float(1).sub(grain.add(fibers).add(0.02)));
    // Shadow wash goes down first, like a watercolour layer under the pen work.
    const washAmount = background.select(float(0), clamp(data.w, 0, 1).mul(distanceFade));
    const base = mix(paperColor, paperColor.mul(wash), washAmount);
    const drawn = mix(base, ink, amount);
    return vec4(mix(drawn, background.select(vec3(1, 0, 1), vec3(data.y)), showTone), 1);
  });

  const pipeline = new RenderPipeline(renderer, composite());
  return { pipeline, edgesOn, hatchOn, showTone };
}
