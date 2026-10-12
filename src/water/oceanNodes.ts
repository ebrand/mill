// GPU side of the ocean, in TSL. Wave math mirrors waves.ts; debug/parity.ts checks the two
// agree by evaluating this code in a compute shader and comparing against the CPU.

import { Color, Vector2, Vector3, Vector4 } from 'three';
import {
  abs,
  cameraFar,
  cameraNear,
  cameraPosition,
  clamp,
  cos,
  cross,
  dot,
  exp,
  float,
  length,
  max,
  mix,
  mx_noise_float,
  normalize,
  perspectiveDepthToViewZ,
  positionLocal,
  positionView,
  positionWorld,
  pow,
  reflect,
  screenUV,
  sin,
  smoothstep,
  uniform,
  varying,
  vec3,
  vec4,
  viewportDepthTexture,
  viewportSharedTexture,
} from 'three/tsl';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import type { GerstnerOcean } from './waves';

type Node = any; // TSL node types are too loose to be worth fighting here.

export interface Lighting {
  sunDirection: Vector3;
  sunColor: Color;
  zenithColor: Color;
  horizonColor: Color;
}

export function createLightingUniforms(l: Lighting) {
  return {
    sunDir: uniform(l.sunDirection.clone().normalize()),
    sunColor: uniform(l.sunColor.clone()),
    zenith: uniform(l.zenithColor.clone()),
    horizon: uniform(l.horizonColor.clone()),
  };
}
export type LightingUniforms = ReturnType<typeof createLightingUniforms>;

/** Sky radiance along a world direction. Used for the background and water reflections. */
export function skyColor(dir: Node, L: LightingUniforms): Node {
  const up = max(dir.y, 0);
  const base = mix(L.horizon, L.zenith, pow(up, 0.45));
  const below = L.horizon.mul(0.6);
  const sky = mix(below, base, smoothstep(-0.02, 0.0, dir.y));
  const mu = max(dot(dir, L.sunDir), 0);
  const disk = smoothstep(0.9996, 0.9999, mu).mul(40);
  const glow = pow(mu, 12).mul(0.35).add(pow(mu, 300).mul(1.5));
  return sky.add(L.sunColor.mul(disk.add(glow)));
}

/**
 * Per-wave uniforms plus TSL builders for displacement and surface frame. `fade` lets
 * callers drop short waves with distance (rendering only; physics never fades).
 */
export function createWaveNodes(ocean: GerstnerOcean) {
  // (dx, dz, k, amplitude) and (q * amplitude, phase)
  const a = ocean.waves.map((w) => uniform(new Vector4(w.dx, w.dz, w.k, w.amplitude)));
  const b = ocean.waves.map((w) => uniform(new Vector2(w.q * w.amplitude, 0)));
  const wavelengths = ocean.waves.map((w) => (2 * Math.PI) / w.k);

  function sync(): void {
    for (let i = 0; i < b.length; i++) b[i].value.y = ocean.phase[i];
  }

  /** Displacement of the undisplaced surface point p (vec2). */
  function displacement(p: Node, fade?: (i: number) => Node): Node {
    let d: Node = vec3(0, 0, 0);
    for (let i = 0; i < a.length; i++) {
      const w = a[i];
      const theta = w.z.mul(dot(w.xy, p)).sub(b[i].y);
      const c = cos(theta);
      let term: Node = vec3(b[i].x.mul(w.x).mul(c), w.w.mul(sin(theta)), b[i].x.mul(w.y).mul(c));
      if (fade) term = term.mul(fade(i));
      d = d.add(term);
    }
    return d;
  }

  /** Tangents of the displaced surface; returns { normal, jacobian }. */
  function frame(p: Node, fade?: (i: number) => Node) {
    let tx: Node = vec3(1, 0, 0);
    let tz: Node = vec3(0, 0, 1);
    for (let i = 0; i < a.length; i++) {
      const w = a[i];
      const theta = w.z.mul(dot(w.xy, p)).sub(b[i].y);
      const s = sin(theta);
      const c = cos(theta);
      let qaks: Node = b[i].x.mul(w.z).mul(s);
      let akc: Node = w.w.mul(w.z).mul(c);
      if (fade) {
        const f = fade(i);
        qaks = qaks.mul(f);
        akc = akc.mul(f);
      }
      tx = tx.add(vec3(qaks.mul(w.x).mul(w.x).negate(), akc.mul(w.x), qaks.mul(w.x).mul(w.y).negate()));
      tz = tz.add(vec3(qaks.mul(w.x).mul(w.y).negate(), akc.mul(w.y), qaks.mul(w.y).mul(w.y).negate()));
    }
    return {
      normal: normalize(cross(tz, tx)),
      jacobian: tx.x.mul(tz.z).sub(tx.z.mul(tz.x)),
    };
  }

  return { a, b, wavelengths, sync, displacement, frame };
}
export type WaveNodes = ReturnType<typeof createWaveNodes>;

export interface OceanMaterialOptions {
  waves: WaveNodes;
  lighting: LightingUniforms;
}

/** Water shading: Fresnel reflection of the sky, refraction with depth absorption, foam. */
export function createOceanMaterial({ waves, lighting: L }: OceanMaterialOptions) {
  // World-space XZ of the mesh origin; the grid follows the camera.
  const origin = uniform(new Vector2());
  // Where wave detail fades from; normally the camera.
  const viewer = uniform(new Vector2());
  const time = uniform(0);

  const absorption = uniform(new Vector3(0.42, 0.075, 0.045));
  const scatterColor = uniform(new Color(0.0, 0.07, 0.11));
  const shallowTint = uniform(new Color(0.55, 0.95, 0.9));

  const p = positionLocal.xz.add(origin);
  const dist = length(p.sub(viewer));

  // Geometry can't carry waves shorter than a few vertex spacings, so fade them early;
  // per-pixel normals keep detail much further out.
  const geomFade = (i: number) => float(1).sub(smoothstep(12 * waves.wavelengths[i], 24 * waves.wavelengths[i], dist));
  const disp = waves.displacement(p, geomFade);

  const material = new MeshBasicNodeMaterial();
  material.positionNode = vec3(positionLocal.x.add(disp.x), disp.y, positionLocal.z.add(disp.z));

  const pV = varying(p, 'vOceanP');
  const heightV: Node = varying(disp.y, 'vOceanHeight');
  const distV = length(pV.sub(viewer));
  const pixelFade = (i: number) =>
    float(1).sub(smoothstep(60 * waves.wavelengths[i], 160 * waves.wavelengths[i], distV));
  const { normal: N, jacobian: J } = waves.frame(pV, pixelFade);

  const V = normalize(cameraPosition.sub(positionWorld));
  const NdotV = clamp(dot(N, V), 0, 1);
  const fresnel = float(0.02).add(float(0.98).mul(pow(float(1).sub(NdotV), 5)));

  // Reflection: sky plus a sharp sun highlight. Keep the reflected ray above the horizon.
  const R0 = reflect(V.negate(), N);
  const R = normalize(vec3(R0.x, abs(R0.y), R0.z));
  const reflection = skyColor(R, L);
  const sunDot = max(dot(R, L.sunDir), 0);
  const specular = L.sunColor.mul(pow(sunDot, 900).mul(30).add(pow(sunDot, 80).mul(0.4)));

  // Refraction: distort the screen lookup by the normal, then measure the water column
  // along the view ray using the scene depth behind the water.
  const fragViewDepth = positionView.z.negate();
  const distort = N.xz.mul(0.06).div(max(fragViewDepth.mul(0.05), 1));
  const uvDistorted = screenUV.add(distort);
  const sceneDepthAt = (uv: Node) =>
    perspectiveDepthToViewZ(viewportDepthTexture(uv), cameraNear, cameraFar).negate();
  const thickDistorted = sceneDepthAt(uvDistorted).sub(fragViewDepth);
  // If the distorted sample lands on something in front of the water, fall back.
  const useDistorted = thickDistorted.greaterThan(0);
  const refractUV = useDistorted.select(uvDistorted, screenUV);
  const thickness = max(useDistorted.select(thickDistorted, sceneDepthAt(screenUV).sub(fragViewDepth)), 0);
  const sceneColor = viewportSharedTexture(refractUV).rgb;

  const transmittance = exp(absorption.mul(thickness).negate());
  const inScatter = scatterColor.mul(float(1).sub(exp(thickness.mul(-0.12))));
  const refracted = sceneColor.mul(transmittance).mul(mix(vec3(1, 1, 1), shallowTint, transmittance.g.mul(0.35))).add(inScatter);

  // Light passing through thin wave crests toward the viewer.
  const sss = pow(max(dot(V, L.sunDir.negate().add(vec3(0, 0.3, 0)).normalize()), 0), 4)
    .mul(clamp(heightV.mul(0.8).add(0.2), 0, 1))
    .mul(0.25);
  const sssColor = vec3(0.1, 0.45, 0.4).mul(sss).mul(L.sunColor);

  let color: Node = mix(refracted.add(sssColor), reflection, fresnel).add(specular);

  // Foam: where the surface compresses (crests) and where the water is very shallow.
  const n1 = mx_noise_float(vec3(pV.mul(0.35), time.mul(0.25))).mul(0.5).add(0.5);
  const n2 = mx_noise_float(vec3(pV.mul(1.7), time.mul(0.6))).mul(0.5).add(0.5);
  const foamNoise = n1.mul(0.6).add(n2.mul(0.4));
  const crestFoam = smoothstep(0.62, 0.32, J).mul(smoothstep(0.35, 0.7, foamNoise));
  const shoreBand = float(1).sub(smoothstep(0.0, 1.1, thickness));
  const shoreWave = sin(thickness.mul(7).sub(time.mul(1.6)).add(n1.mul(6))).mul(0.5).add(0.5);
  const shoreFoam = shoreBand.mul(smoothstep(0.25, 0.75, shoreWave.mul(0.6).add(foamNoise.mul(0.6))));
  const foam = clamp(crestFoam.add(shoreFoam), 0, 1);
  const foamLit = L.sunColor.mul(max(L.sunDir.y, 0).mul(0.75)).add(L.zenith.mul(0.6));
  color = mix(color, foamLit, foam.mul(0.85));

  // Haze toward the horizon so the far edge of the grid disappears.
  const haze = smoothstep(800, 3500, length(positionWorld.xz.sub(cameraPosition.xz)));
  color = mix(color, skyColor(normalize(vec3(V.x.negate(), 0.001, V.z.negate())), L), haze);

  material.colorNode = vec4(color, 1);
  material.transparent = true;
  material.depthWrite = true;

  return { material, origin, viewer, time, absorption, scatterColor };
}
