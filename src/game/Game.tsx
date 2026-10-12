import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { Color, DirectionalLight, HemisphereLight, Mesh, Quaternion, Vector3 } from 'three';
import { normalize, positionWorldDirection } from 'three/tsl';
import type { WebGPURenderer } from 'three/webgpu';
import { checkWaveParity, probeWaveUniforms } from '../debug/parity';
import { FixedStep } from '../sim/fixedStep';
import { centerSpacing, createOceanGeometry } from '../water/oceanGeometry';
import { createLightingUniforms, createOceanMaterial, createWaveNodes, skyColor } from '../water/oceanNodes';
import { GerstnerOcean, newSample } from '../water/waves';
import { createTerrainMesh } from '../world/terrainMesh';
import { createBoatMesh } from './boatMesh';
import { KeyboardInput } from './input';
import { GameSim } from './sim';

const SUN_DIRECTION = new Vector3(-0.45, 0.32, -0.6).normalize();
const SUN_COLOR = new Color(1.0, 0.92, 0.8).multiplyScalar(2.2);

export interface HudState {
  speed: number;
  fps: number;
}

export function Game({ onHud }: { onHud?: (s: HudState) => void }) {
  const { scene, camera, gl } = useThree();
  const renderer = gl as unknown as WebGPURenderer;

  const world = useMemo(() => {
    const ocean = new GerstnerOcean();
    const sim = new GameSim({ water: ocean, boatStart: new Vector3(40, 0, -150) });
    // Face the island.
    sim.boat.body.setRotation(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), -0.25), true);

    const lighting = createLightingUniforms({
      sunDirection: SUN_DIRECTION,
      sunColor: SUN_COLOR,
      zenithColor: new Color(0.16, 0.36, 0.72),
      horizonColor: new Color(0.68, 0.8, 0.9),
    });
    const waves = createWaveNodes(ocean);
    const oceanMat = createOceanMaterial({ waves, lighting });
    const oceanMesh = new Mesh(createOceanGeometry(), oceanMat.material);
    oceanMesh.frustumCulled = false;
    oceanMesh.renderOrder = 10;

    const terrainMesh = createTerrainMesh(sim.terrain!);
    const boatMesh = createBoatMesh(sim.boat.spec);

    const sun = new DirectionalLight(SUN_COLOR.clone().multiplyScalar(0.55), 2.2);
    sun.position.copy(SUN_DIRECTION).multiplyScalar(400);
    const hemi = new HemisphereLight(0xbfd8f0, 0x5a4a35, 0.9);

    return { ocean, sim, lighting, waves, oceanMat, oceanMesh, terrainMesh, boatMesh, sun, hemi };
  }, []);

  useEffect(() => {
    const { oceanMesh, terrainMesh, boatMesh, sun, hemi, lighting, sim } = world;
    const prevBackground = scene.backgroundNode;
    scene.backgroundNode = skyColor(normalize(positionWorldDirection), lighting);
    scene.add(oceanMesh, terrainMesh, boatMesh, sun, sun.target, hemi);
    return () => {
      scene.remove(oceanMesh, terrainMesh, boatMesh, sun, sun.target, hemi);
      scene.backgroundNode = prevBackground;
      sim.dispose();
    };
  }, [scene, world]);

  const keyboard = useMemo(() => new KeyboardInput(), []);
  useEffect(() => keyboard.attach(), [keyboard]);

  const loop = useRef({
    fixed: new FixedStep(1 / 60),
    prevPos: new Vector3(),
    currPos: new Vector3(),
    prevRot: new Quaternion(),
    currRot: new Quaternion(),
    renderPos: new Vector3(),
    camYaw: Math.PI,
    camPitch: 0.28,
    camDist: 14,
    camPos: new Vector3(),
    camInit: false,
    tmp: new Vector3(),
    forward: new Vector3(),
    sample: newSample(),
    hudTimer: 0,
    frames: 0,
  });

  // Mouse orbit around the boat.
  useEffect(() => {
    const el = renderer.domElement;
    let dragging = false;
    const down = (e: PointerEvent) => {
      dragging = true;
      el.setPointerCapture(e.pointerId);
    };
    const up = (e: PointerEvent) => {
      dragging = false;
      el.releasePointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (!dragging) return;
      const l = loop.current;
      l.camYaw -= e.movementX * 0.005;
      l.camPitch = Math.min(1.3, Math.max(0.02, l.camPitch + e.movementY * 0.004));
    };
    const wheel = (e: WheelEvent) => {
      const l = loop.current;
      l.camDist = Math.min(80, Math.max(5, l.camDist * Math.exp(e.deltaY * 0.001)));
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointermove', move);
    el.addEventListener('wheel', wheel, { passive: true });
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('wheel', wheel);
    };
  }, [renderer]);

  // Dev-only hooks for checking the GPU/CPU wave agreement from the console or tests.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const w = window as unknown as Record<string, unknown>;
    w.__water = {
      sim: world.sim,
      ocean: world.ocean,
      parity: (opts?: Parameters<typeof checkWaveParity>[2]) => checkWaveParity(renderer, world.ocean, opts),
      probe: () => probeWaveUniforms(renderer, world.waves),
      camera,
      loop: loop.current,
    };
    return () => {
      delete w.__water;
    };
  }, [renderer, world, camera]);

  const spacing = useMemo(() => centerSpacing() * 4, []);

  useFrame((_, delta) => {
    const l = loop.current;
    const { sim, ocean, waves, oceanMat, oceanMesh, boatMesh } = world;
    const body = sim.boat.body;

    if (!l.camInit) {
      const t = body.translation();
      const r = body.rotation();
      l.currPos.set(t.x, t.y, t.z);
      l.currRot.set(r.x, r.y, r.z, r.w);
    }

    const alpha = l.fixed.advance(Math.min(delta, 0.25), (dt) => {
      keyboard.update(dt, sim.input);
      l.prevPos.copy(l.currPos);
      l.prevRot.copy(l.currRot);
      sim.step();
      const t = body.translation();
      const r = body.rotation();
      l.currPos.set(t.x, t.y, t.z);
      l.currRot.set(r.x, r.y, r.z, r.w);
    });

    // Render the state between the last two steps, and the water at the matching time.
    const dt = l.fixed.dt;
    const renderTime = sim.time - (1 - alpha) * dt;
    ocean.setTime(renderTime);
    waves.sync();
    oceanMat.time.value = renderTime;

    l.renderPos.lerpVectors(l.prevPos, l.currPos, alpha);
    boatMesh.position.copy(l.renderPos);
    boatMesh.quaternion.slerpQuaternions(l.prevRot, l.currRot, alpha);

    // Chase camera: orbit offset relative to the boat's heading.
    l.forward.set(0, 0, 1).applyQuaternion(boatMesh.quaternion);
    const heading = Math.atan2(l.forward.x, l.forward.z);
    const yaw = heading + l.camYaw;
    const cp = Math.cos(l.camPitch);
    l.tmp.set(
      l.renderPos.x + Math.sin(yaw) * cp * l.camDist,
      l.renderPos.y + 1.5 + Math.sin(l.camPitch) * l.camDist,
      l.renderPos.z + Math.cos(yaw) * cp * l.camDist,
    );
    if (!l.camInit) {
      l.camPos.copy(l.tmp);
      l.camInit = true;
    } else {
      l.camPos.lerp(l.tmp, 1 - Math.exp(-delta * 4));
    }
    // Never let the camera dip under the surface; there's no underwater rendering yet.
    ocean.sample(l.camPos.x, l.camPos.z, l.sample);
    l.camPos.y = Math.max(l.camPos.y, l.sample.height + 0.6);
    camera.position.copy(l.camPos);
    camera.lookAt(l.renderPos.x, l.renderPos.y + 1.2, l.renderPos.z);

    // Ocean grid follows the camera, snapped so vertices don't slide over the waves.
    const ox = Math.round(camera.position.x / spacing) * spacing;
    const oz = Math.round(camera.position.z / spacing) * spacing;
    oceanMesh.position.set(ox, 0, oz);
    oceanMat.origin.value.set(ox, oz);
    oceanMat.viewer.value.set(camera.position.x, camera.position.z);

    l.frames++;
    l.hudTimer += delta;
    if (onHud && l.hudTimer >= 0.25) {
      const v = body.linvel();
      onHud({ speed: Math.hypot(v.x, v.z), fps: l.frames / l.hudTimer });
      l.hudTimer = 0;
      l.frames = 0;
    }
  });

  return null;
}
