import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  Group,
  Mesh,
  type Material,
  PlaneGeometry,
  Shape,
  TorusGeometry,
} from 'three';
import { float, positionWorld, vec2 } from 'three/tsl';
import { fallingWaterMaterial, inkMaterial, waterMaterial } from '../ink/materials';
import type { TerrainField } from '../world/terrainField';
import { TerrainMeshes } from '../world/terrainMesh';
import {
  DAM_TOP,
  DAM_X,
  downstreamWaterLevel,
  FLUME,
  MILL,
  riverBed,
  riverCenter,
  type SiteStart,
  SPILLWAY_CREST,
  SPILLWAY_HALF_WIDTH,
  terrainHeight,
  WHEEL,
} from './site';


function box(w: number, h: number, d: number, material: Material, x: number, y: number, z: number): Mesh {
  const m = new Mesh(new BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** A horizontal strip whose height follows level(x). */
function waterStrip(x0: number, x1: number, z0: number, z1: number, level: (x: number) => number, material: Material): Mesh {
  const segs = Math.max(1, Math.round(x1 - x0));
  const g = new PlaneGeometry(x1 - x0, z1 - z0, segs, 1);
  g.rotateX(-Math.PI / 2);
  const pos = g.getAttribute('position') as BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + (x0 + x1) / 2;
    pos.setXYZ(i, x, level(x), pos.getZ(i) + (z0 + z1) / 2);
  }
  g.computeVertexNormals();
  return new Mesh(g, material);
}

/** Quad from four corners, for sheets of falling water. */
function quad(corners: [number, number, number][], material: Material): Mesh {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(corners.flat()), 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  g.computeVertexNormals();
  return new Mesh(g, material);
}

/**
 * Water that isn't simulated: the flume (until head gates and races arrive in M3) and the
 * falling sheets. River and pond water come from the sim (see water/waterSurface.ts).
 */
function decorativeWater(): { group: Group; spillSheet: Mesh; flumeWater: Group } {
  const group = new Group();
  const flumeWater = new Group();
  group.add(flumeWater);
  flumeWater.add(
    waterStrip(
      FLUME.x0,
      FLUME.x1,
      FLUME.z - FLUME.halfWidth + 0.1,
      FLUME.z + FLUME.halfWidth - 0.1,
      () => FLUME.water,
      waterMaterial({ speed: float(1), flowCoord: vec2(positionWorld.x, positionWorld.z.sub(FLUME.z)) }),
    ),
  );

  // Sheet over the spillway (shown only while the sim says water is going over), and the
  // jet from the flume onto the wheel.
  const c = riverCenter(DAM_X);
  const falling = fallingWaterMaterial();
  const bottom = downstreamWaterLevel(DAM_X + 1.8);
  const spillSheet = quad(
    [
      [DAM_X + 0.5, SPILLWAY_CREST + 0.15, c - SPILLWAY_HALF_WIDTH],
      [DAM_X + 0.5, SPILLWAY_CREST + 0.15, c + SPILLWAY_HALF_WIDTH],
      [DAM_X + 1.8, bottom, c + SPILLWAY_HALF_WIDTH],
      [DAM_X + 1.8, bottom, c - SPILLWAY_HALF_WIDTH],
    ],
    falling,
  );
  group.add(spillSheet);
  flumeWater.add(
    quad(
      [
        [FLUME.x1, FLUME.water, FLUME.z - 1],
        [FLUME.x1, FLUME.water, FLUME.z + 1],
        [FLUME.x1 + 0.35, WHEEL.y + 0.6, FLUME.z + 1],
        [FLUME.x1 + 0.35, WHEEL.y + 0.6, FLUME.z - 1],
      ],
      falling,
    ),
  );
  return { group, spillSheet, flumeWater };
}

function dam(): Group {
  const group = new Group();
  const c = riverCenter(DAM_X);
  const timber = inkMaterial({ albedo: 0.7, pattern: 'boards', angle: 1.2 });
  const stone = inkMaterial({ albedo: 0.85, pattern: 'masonry', angle: 0.5 });
  const base = riverBed(DAM_X) - 0.3;

  // Timber crib spillway in the channel, with a sloping apron below it.
  group.add(box(1.0, SPILLWAY_CREST - base, SPILLWAY_HALF_WIDTH * 2, timber, DAM_X, (SPILLWAY_CREST + base) / 2, c));
  const apron = box(2.0, 0.2, SPILLWAY_HALF_WIDTH * 2, timber, DAM_X + 1.2, (SPILLWAY_CREST + base) / 2 - 0.4, c);
  apron.rotation.z = -0.9;
  group.add(apron);

  // Stone abutments tying the dam into the banks.
  const wing = 26;
  for (const side of [-1, 1]) {
    const zc = c + side * (SPILLWAY_HALF_WIDTH + wing / 2);
    group.add(box(1.6, DAM_TOP - base, wing, stone, DAM_X, (DAM_TOP + base) / 2, zc));
  }
  return group;
}

function flume(): Group {
  const group = new Group();
  const timber = inkMaterial({ albedo: 0.72, pattern: 'boards', angle: 1.1 });
  const len = FLUME.x1 - FLUME.x0;
  const cx = (FLUME.x0 + FLUME.x1) / 2;
  group.add(box(len, 0.12, FLUME.halfWidth * 2, timber, cx, FLUME.bottom, FLUME.z));
  for (const side of [-1, 1]) {
    group.add(box(len, FLUME.top - FLUME.bottom, 0.1, timber, cx, (FLUME.top + FLUME.bottom) / 2, FLUME.z + side * FLUME.halfWidth));
  }
  // Trestle posts down to the ground.
  for (let x = FLUME.x0 + 1; x < FLUME.x1; x += 2.2) {
    for (const side of [-1, 1]) {
      const z = FLUME.z + side * (FLUME.halfWidth - 0.1);
      const ground = terrainHeight(x, z) - 0.3;
      group.add(box(0.2, FLUME.bottom - ground, 0.2, timber, x, (FLUME.bottom + ground) / 2, z));
    }
  }
  return group;
}

/**
 * A breastshot wheel of radius r and width w, centred on the origin with its axle along
 * local Z. Rotate `spin` about Z to turn it.
 */
export function createWheelModel(r: number, w: number): { group: Group; spin: Group } {
  const iron = inkMaterial({ albedo: 0.45, pattern: 'iron' });
  const timber = inkMaterial({ albedo: 0.7, pattern: 'boards', angle: 0.4 });
  const spin = new Group();
  for (const side of [-1, 1]) {
    const rim = new Mesh(new TorusGeometry(r, 0.09, 8, 64), iron);
    rim.position.z = (side * w) / 2;
    rim.castShadow = true;
    spin.add(rim);
    for (let i = 0; i < 8; i++) {
      const spoke = box(0.12, r * 2, 0.12, timber, 0, 0, (side * w) / 2);
      spoke.rotation.z = (i / 8) * Math.PI;
      spin.add(spoke);
    }
  }
  const buckets = Math.max(16, Math.round(r * 11.7));
  for (let i = 0; i < buckets; i++) {
    const a = (i / buckets) * Math.PI * 2;
    const bucket = box(0.06, Math.min(0.55, r * 0.23), w, timber, Math.cos(a) * (r - 0.25), Math.sin(a) * (r - 0.25), 0);
    bucket.rotation.z = a + 0.35;
    spin.add(bucket);
  }
  const axle = new Mesh(new CylinderGeometry(0.15, 0.15, w + 1.2, 16), iron);
  axle.rotation.x = Math.PI / 2;
  axle.castShadow = true;
  const group = new Group();
  group.add(spin, axle);
  return { group, spin };
}

/** A sluice gate: two posts and a plank raised `opening` above the sill. Plank is `plank`. */
export function createGateModel(width: number, height: number): { group: Group; plank: Mesh } {
  const timber = inkMaterial({ albedo: 0.7, pattern: 'boards', angle: 1.2 });
  const group = new Group();
  for (const side of [-1, 1]) group.add(box(0.3, height, 0.3, timber, 0, height / 2, (side * (width + 0.3)) / 2));
  group.add(box(0.3, 0.25, width + 0.9, timber, 0, height + 0.12, 0));
  const plank = box(0.12, Math.min(1.2, height * 0.6), width, timber, 0, 0, 0);
  group.add(plank);
  return { group, plank };
}

/**
 * A timber-crib spillway `length` long along local X, `height` tall from its foot (local
 * y = 0) to the crest, with a falling sheet on its local +Z face (shown when spilling).
 */
export function createSpillwayModel(length: number, height: number): { group: Group; sheet: Mesh } {
  const timber = inkMaterial({ albedo: 0.7, pattern: 'boards', angle: 1.2 });
  const group = new Group();
  group.add(box(length, height, 1.4, timber, 0, height / 2, 0));
  // A sloping apron to break the fall.
  const apron = box(length, 0.2, 1.8, timber, 0, 0.3, 1.4);
  apron.rotation.x = 0.6;
  group.add(apron);
  const sheet = quad(
    [
      [-length / 2, height + 0.12, 0.72],
      [length / 2, height + 0.12, 0.72],
      [length / 2, 0.2, 2.1],
      [-length / 2, 0.2, 2.1],
    ],
    fallingWaterMaterial(),
  );
  sheet.visible = false;
  group.add(sheet);
  return { group, sheet };
}

/** The original mill's wheel; the returned group spins about its axle (local Z). */
function wheel(): Group {
  const iron = inkMaterial({ albedo: 0.45, pattern: 'iron' });
  const { radius: r, width: w } = WHEEL;
  const model = createWheelModel(r, w);
  const holder = new Group();
  holder.position.set(WHEEL.x, WHEEL.y, WHEEL.z);
  holder.add(model.group);
  // Axle runs from the wheel through the mill's south wall to the pit gear inside.
  const axleLen = MILL.z0 + 1.6 - (WHEEL.z - w / 2 - 0.3);
  const axle = new Mesh(new CylinderGeometry(0.15, 0.15, axleLen, 16), iron);
  axle.rotation.x = Math.PI / 2;
  axle.position.set(WHEEL.x, WHEEL.y, WHEEL.z - w / 2 - 0.3 + axleLen / 2);
  axle.castShadow = true;
  const group = new Group();
  group.add(holder, axle);
  group.userData.spin = model.spin;
  return group;
}

function windowRow(group: Group, material: Material, axis: 'x' | 'z', from: number, to: number, fixed: number, count: number) {
  for (const floorY of [MILL.base + 1.9, MILL.base + 5.3, MILL.base + 8.7]) {
    for (let i = 0; i < count; i++) {
      const t = from + ((i + 0.5) / count) * (to - from);
      const w = axis === 'x' ? box(1.0, 1.7, 0.12, material, t, floorY, fixed) : box(0.12, 1.7, 1.0, material, fixed, floorY, t);
      group.add(w);
    }
  }
}

export interface MillParts {
  group: Group;
  /** Hidden in cutaway mode. */
  cutaway: Group;
}

function mill(): MillParts {
  const group = new Group();
  const cutaway = new Group();
  const stone = inkMaterial({ albedo: 0.82, pattern: 'masonry', angle: 0.6 });
  const roofMat = inkMaterial({ albedo: 0.62, pattern: 'roof', angle: 1.4 });
  const glass = inkMaterial({ albedo: 0.18, pattern: 'glass', angle: 0.9 });
  const boards = inkMaterial({ albedo: 0.75, pattern: 'boards', angle: 0.2 });
  const iron = inkMaterial({ albedo: 0.45, pattern: 'iron' });
  const machineMat = inkMaterial({ albedo: 0.6, pattern: 'plain', angle: 1.0 });

  const { x0, x1, z0, z1, base, wallTop, ridge, wall } = MILL;
  const lx = x1 - x0;
  const lz = z1 - z0;
  const h = wallTop - base;
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;

  // Walls. The south wall faces the river and is the one removed for the cutaway.
  const south = box(lx, h, wall, stone, cx, base + h / 2, z0 + wall / 2);
  cutaway.add(south);
  windowRow(cutaway, glass, 'x', x0 + 2, x1 - 1, z0 - 0.02, 7);
  group.add(box(lx, h, wall, stone, cx, base + h / 2, z1 - wall / 2));
  windowRow(group, glass, 'x', x0 + 1, x1 - 1, z1 + 0.02, 7);
  for (const x of [x0 + wall / 2, x1 - wall / 2]) group.add(box(wall, h, lz - 2 * wall, stone, x, base + h / 2, cz));
  windowRow(group, glass, 'z', z0 + 1, z1 - 1, x0 - 0.02, 3);
  windowRow(group, glass, 'z', z0 + 1, z1 - 1, x1 + 0.02, 3);

  // Gables.
  const gable = new Shape();
  gable.moveTo(z0, wallTop);
  gable.lineTo(z1, wallTop);
  gable.lineTo(cz, ridge);
  gable.closePath();
  for (const x of [x0, x1 - wall]) {
    const g = new ExtrudeGeometry(gable, { depth: wall, bevelEnabled: false });
    // Shape is in (z, y); extrude along +X.
    // Rotating maps the extrusion to -X; shift it back to [0, wall].
    g.rotateY(-Math.PI / 2);
    g.translate(wall, 0, 0);
    const m = new Mesh(g, stone);
    m.position.x = x;
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  }

  // Roof slopes with a small overhang.
  const run = lz / 2 + 0.5;
  const rise = ridge - wallTop;
  const slope = Math.hypot(run, rise);
  const pitch = Math.atan2(rise, run);
  for (const side of [-1, 1]) {
    const slab = box(lx + 0.8, 0.25, slope, roofMat, cx, (ridge + wallTop) / 2 + 0.1, cz + (side * run) / 2);
    slab.rotation.x = side * pitch;
    (side < 0 ? cutaway : group).add(slab);
  }

  // Interior: floors, the pit gear and upright shaft, line shafts with pulleys, machines.
  const floors = [base + 3.4, base + 6.8];
  for (const y of [base + 0.1, ...floors]) group.add(box(lx - 2 * wall, 0.18, lz - 2 * wall, boards, cx, y, cz));

  const pitGear = new Mesh(new CylinderGeometry(1.6, 1.6, 0.35, 40), iron);
  pitGear.rotation.x = Math.PI / 2;
  pitGear.position.set(WHEEL.x, WHEEL.y, z0 + 1.4);
  const upright = new Mesh(new CylinderGeometry(0.16, 0.16, wallTop - base - 0.3, 12), iron);
  upright.position.set(WHEEL.x, (wallTop + base) / 2, z0 + 2.4);
  for (const m of [pitGear, upright]) {
    m.castShadow = true;
    group.add(m);
  }

  for (const y of [base, ...floors]) {
    const shaftY = y + 3.0;
    const shaft = new Mesh(new CylinderGeometry(0.09, 0.09, lx - 3, 10), iron);
    shaft.rotation.z = Math.PI / 2;
    shaft.position.set(cx + 0.5, shaftY, z0 + 2.4);
    group.add(shaft);
    for (let x = x0 + 4; x < x1 - 1; x += 3) {
      const pulley = new Mesh(new CylinderGeometry(0.45, 0.45, 0.25, 20), iron);
      pulley.rotation.z = Math.PI / 2;
      pulley.position.set(x, shaftY, z0 + 2.4);
      group.add(pulley);
      // Belt down to a machine.
      group.add(box(0.12, 2.0, 0.04, machineMat, x + 0.1, shaftY - 1.15, z0 + 2.4 + 0.42));
      group.add(box(2.2, 1.1, 1.0, machineMat, x, y + 0.65, z0 + 3.4));
    }
  }

  group.add(cutaway);
  return { group, cutaway };
}

/** The old mill demo's works: models only, present for that start. */
export interface OldWorks {
  cutaway: Group;
  wheelSpin: Group;
  spillSheet: Mesh;
  /** Water in the flume and the jet onto the wheel; shown only while the gate passes water. */
  flumeWater: Group;
}

export interface Site {
  root: Group;
  terrain: TerrainMeshes;
  /** The old dam, mill, flume and wheel; null in the untouched valley. */
  oldWorks: OldWorks | null;
}

export function buildSite(field: TerrainField, start: SiteStart = 'oldMill'): Site {
  const root = new Group();
  const terrain = new TerrainMeshes(field, inkMaterial({ albedo: 0.92, pattern: 'terrain', angle: 0.35, hatchStart: 0.62 }));
  root.add(terrain.group);
  if (start !== 'oldMill') return { root, terrain, oldWorks: null };
  const millParts = mill();
  const wheelGroup = wheel();
  const water = decorativeWater();
  root.add(water.group, dam(), flume(), wheelGroup, millParts.group);
  return {
    root,
    terrain,
    oldWorks: { cutaway: millParts.cutaway, wheelSpin: wheelGroup.userData.spin as Group, spillSheet: water.spillSheet, flumeWater: water.flumeWater },
  };
}

