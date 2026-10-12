// Materials output *ink coverage* (0 = paper, 1 = ink) rather than a color. The post pass
// combines coverage with outlines and the paper texture, so every material reads as part
// of one drawing.

import { Color, DoubleSide, FrontSide, type Side, Vector3 } from 'three';
import {
  abs,
  clamp,
  dot,
  float,
  floor,
  fract,
  frontFacing,
  fwidth,
  luminance,
  max,
  min,
  mx_noise_float,
  normalWorld,
  output,
  positionWorld,
  pow,
  select,
  smoothstep,
  sin,
  uniform,
  vec2,
  vec4,
} from 'three/tsl';
import { MeshBasicNodeMaterial, MeshLambertNodeMaterial } from 'three/webgpu';
import { hatch, lineFamily, wobble, type Node } from './hatching';

export const inkTime = uniform(0);
/**
 * Converts lit (linear) radiance into tone. Set to PI / sun intensity so a white surface
 * facing the sun reads as 1. Tunable live from the dev console (window.__mill.tone).
 */
export const toneGain = uniform(1.0);

/** The scene's lighting, mirrored here so materials can separate shadow from form. */
export const lighting = {
  sunDir: uniform(new Vector3(0, 1, 0)),
  sunIntensity: uniform(1),
  ambientIntensity: uniform(0),
};
/** 1: shadows are a flat wash (no hatching). 0: shadows are hatched like everything else. */
export const washShadows = uniform(1);

/** 2D surface coordinates picked by the dominant axis of the world normal. */
function planarCoord(): Node {
  const n = abs(normalWorld);
  const p = positionWorld;
  const onTop = n.y.greaterThan(max(n.x, n.z));
  const onX = n.x.greaterThan(n.z);
  return select(onTop, vec2(p.x, p.z), select(onX, vec2(p.z, p.y), vec2(p.x, p.y)));
}

export type Pattern = 'terrain' | 'masonry' | 'boards' | 'roof' | 'plain' | 'iron' | 'glass';

export interface InkMaterialOptions {
  /** Surface lightness before lighting, 0..1. */
  albedo: number;
  pattern: Pattern;
  /** Base hatch angle in radians, to vary direction between surfaces. */
  angle?: number;
  /** Tone below which hatching starts (default 0.9). Lower keeps lit surfaces bare. */
  hatchStart?: number;
  side?: Side;
}

function patternLines(pattern: Pattern, coord: Node): Node {
  const thin = 0.75;
  switch (pattern) {
    case 'terrain': {
      // Engraver's contours: lines of equal height, denser on steep ground.
      const y = positionWorld.y;
      const contour = lineFamily(vec2(0, y), vec2(0, 1), { base: 0.35, targetPx: 6, widthPx: thin });
      // Contours alone vanish on flat ground; that's intended, flat land reads as paper.
      return contour.mul(0.55);
    }
    case 'masonry': {
      // Courses, plus staggered joints that fade out when too small to read.
      const course = 0.45;
      const courses = lineFamily(coord, vec2(0, 1), { base: course, targetPx: 5, widthPx: thin });
      const row = floor(coord.y.div(course));
      const u = coord.x.add(fract(row.mul(0.5)).mul(0.9));
      const joints = lineFamily(vec2(u, 0), vec2(1, 0), { base: 0.9, targetPx: 5, widthPx: thin });
      const readable = smoothstep(0.08, 0.03, fwidth(coord.y));
      return max(courses.mul(0.7), joints.mul(readable).mul(0.6));
    }
    case 'boards':
      return lineFamily(coord, vec2(1, 0), { base: 0.28, targetPx: 5, widthPx: thin }).mul(0.7);
    case 'roof': {
      const rows = lineFamily(coord, vec2(0, 1), { base: 0.32, targetPx: 5, widthPx: thin });
      return rows.mul(0.65);
    }
    case 'glass': {
      // Window openings read dark in any light: a dense fill with light glazing bars cut out.
      const bars = max(
        lineFamily(coord, vec2(1, 0), { base: 0.33, targetPx: 4, widthPx: 1.2 }),
        lineFamily(coord, vec2(0, 1), { base: 0.42, targetPx: 4, widthPx: 1.2 }),
      );
      return float(0.62).mul(float(1).sub(bars.mul(0.8)));
    }
    case 'iron':
    case 'plain':
      return float(0);
  }
}

/** Lit, hatched, opaque surface. */
export function inkMaterial({ albedo, pattern, angle = 0.8, hatchStart = 0.9, side = FrontSide }: InkMaterialOptions) {
  const material = new MeshLambertNodeMaterial({ color: new Color(albedo, albedo, albedo), side });
  const coord = wobble(planarCoord(), positionWorld, pattern === 'terrain' ? 0.12 : 0.03);
  const { sunDir, sunIntensity, ambientIntensity } = lighting;

  // Lambert gives lit = albedo/PI * (ambient + sun * N.L * visibility). Everything but the
  // shadow-map visibility is known, so solve for it. This separates cast shadow from form.
  const lit = luminance(output.rgb);
  const nDotL = dot(normalWorld, sunDir);
  const direct = lit.mul(Math.PI / albedo).sub(ambientIntensity);
  const visibility = clamp(direct.div(max(sunIntensity.mul(nDotL), 1e-4)), 0, 1);
  // Faces turned from the sun are in shadow too; soften the terminator slightly.
  const facing = smoothstep(-0.02, 0.1, nDotL);
  const shadow = float(1).sub(visibility.mul(facing));

  // Hatch thresholds are perceptual, so compare in gamma space, not linear light.
  const toneAll = pow(clamp(lit.mul(toneGain), 0, 1), 1 / 2.2);
  // Tone from form alone (as if nothing cast a shadow), used when shadows are a wash.
  const formLit = ambientIntensity.add(sunIntensity.mul(max(nDotL, 0))).mul(albedo / Math.PI);
  const toneForm = pow(clamp(formLit.mul(toneGain), 0, 1), 1 / 2.2);

  const hatchedShadows = hatch(toneAll, coord, angle, hatchStart);
  const formHatch = hatch(toneForm, coord, angle, hatchStart).mul(float(1).sub(shadow));
  let ink: Node = max(washShadows.greaterThan(0.5).select(formHatch, hatchedShadows), patternLines(pattern, coord));
  if (pattern === 'iron') ink = max(ink, float(0.25));
  // Glass is drawn the same in any light; only the shadow wash changes it.
  if (pattern === 'glass') ink = patternLines(pattern, coord);
  let wash: Node = shadow.mul(washShadows);
  // Inside faces of cut-open walls draw as solid poché, the convention for sections.
  if (side === DoubleSide) {
    ink = select(frontFacing, ink, float(0.92));
    wash = select(frontFacing, wash, float(0));
  }
  // x: ink coverage, y: tone (debug view), z: surface id (0 = solid), w: shadow wash.
  material.outputNode = vec4(clamp(ink, 0, 1), toneAll, 0, wash);
  return material;
}

export interface WaterOptions {
  /** World-space speed of the current (m/s) as a TSL node; 0 for still water. */
  speed: Node;
  /** Coordinates along (x) and across (y) the flow, in meters. */
  flowCoord: Node;
}

/**
 * Water drawn the way an illustrator would: broken horizontal strokes on still water,
 * lines that follow the current (with dashes moving downstream) where it flows.
 */
export function waterMaterial({ speed, flowCoord }: WaterOptions) {
  const material = new MeshBasicNodeMaterial();
  const p = positionWorld;

  // Still: short horizontal dashes in staggered rows.
  const stillRows = lineFamily(vec2(p.x, p.z), vec2(0, 1), { base: 0.7, targetPx: 9, widthPx: 0.8 });
  const stillDash = smoothstep(0.62, 0.5, fract(p.x.div(3.1).add(mx_noise_float(p.mul(0.35)).mul(1.3))));
  const still = stillRows.mul(stillDash);

  // Flowing: streamlines, broken into dashes that travel at the current's speed.
  const along = flowCoord.x;
  const across = flowCoord.y;
  const streams = lineFamily(vec2(along, across), vec2(0, 1), { base: 0.5, targetPx: 7, widthPx: 0.85 });
  const lane = floor(across.div(0.5));
  const phase = along.sub(inkTime.mul(speed).mul(1.0)).div(2.4).add(fract(sin(lane.mul(12.9898)).mul(43758.5453)));
  const flowDash = smoothstep(0.7, 0.55, fract(phase));
  const flowing = streams.mul(flowDash);

  const s = clamp(speed, 0, 1);
  const ink = max(still.mul(float(1).sub(s)), flowing.mul(min(s.mul(2), 1))).mul(0.85);
  material.outputNode = vec4(ink, 1, 1, 0); // w = 0: no shadow wash on water (yet)
  return material;
}

/** Falling water over a dam crest: vertical streaks moving down. coord.y is height. */
export function fallingWaterMaterial() {
  const material = new MeshBasicNodeMaterial({ side: DoubleSide });
  const p = positionWorld;
  const streaks = lineFamily(vec2(p.z, 0), vec2(1, 0), { base: 0.18, targetPx: 4, widthPx: 0.8 });
  const lane = floor(p.z.div(0.18));
  const fall = fract(p.y.add(inkTime.mul(2.5)).div(1.3).add(fract(sin(lane.mul(78.233)).mul(43758.5453))));
  const ink = streaks.mul(smoothstep(0.75, 0.6, fall)).mul(0.9);
  material.outputNode = vec4(ink, 1, 1, 0); // w = 0: no shadow wash on water (yet)
  return material;
}
