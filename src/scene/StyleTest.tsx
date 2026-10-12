import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { AmbientLight, DirectionalLight, NoToneMapping, type PerspectiveCamera } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { WebGPURenderer } from 'three/webgpu';
import { inkTime, lighting, toneGain, washShadows } from '../ink/materials';
import { createInkPipeline } from '../ink/pipeline';
import type { SimStats } from '../water/protocol';
import { WaterClient } from '../water/WaterClient';
import { createWaterSurface } from '../water/waterSurface';
import { buildSite } from './buildSite';
import { MILL, WHEEL } from './site';

/** Sim cell size: 0.5 m resolves a 3 m headrace with 6 cells (see tests/perf.test.ts). */
const WATER_DX = 0.5;
const SPEEDS = [0, 1, 4, 16];

const SUN_INTENSITY = 3.4;
const AMBIENT_INTENSITY = 0.22;

export const CAMERA_START = { position: [-48, 34, -52] as const, target: [16, 3, 14] as const };

export interface WaterHud {
  stats: SimStats | null;
  speed: number;
  discharge: number;
  error: string | null;
}

/** The pen-and-ink site with the simulated river (M0 scene + M1 water). */
export function StyleTest({ onWater }: { onWater?: (hud: WaterHud) => void }) {
  const { scene, camera, gl } = useThree();
  const renderer = gl as unknown as WebGPURenderer;
  const water = useRef<WaterClient | null>(null);

  const site = useMemo(() => buildSite(), []);
  const ink = useMemo(() => createInkPipeline(renderer, scene, camera), [renderer, scene, camera]);

  useEffect(() => {
    renderer.toneMapping = NoToneMapping;
    renderer.shadowMap.enabled = true;

    const sun = new DirectionalLight(0xffffff, SUN_INTENSITY);
    sun.position.set(-40, 75, -60);
    toneGain.value = Math.PI / SUN_INTENSITY;
    lighting.sunIntensity.value = SUN_INTENSITY;
    lighting.ambientIntensity.value = AMBIENT_INTENSITY;
    sun.target.position.set(15, 0, 15);
    lighting.sunDir.value.copy(sun.position).sub(sun.target.position).normalize();
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    const s = sun.shadow.camera;
    s.left = -70;
    s.right = 70;
    s.top = 70;
    s.bottom = -70;
    s.near = 1;
    s.far = 250;
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.05;
    const ambient = new AmbientLight(0xffffff, AMBIENT_INTENSITY);

    scene.add(site.root, sun, sun.target, ambient);
    return () => {
      scene.remove(site.root, sun, sun.target, ambient);
    };
  }, [scene, renderer, site]);

  // The water worker. Created in an effect (not useMemo) so StrictMode's double mount
  // terminates the extra worker instead of leaking it.
  useEffect(() => {
    const client = new WaterClient({ dx: WATER_DX, prefill: true });
    water.current = client;
    let surface: ReturnType<typeof createWaterSurface> | null = null;
    let disposed = false;
    client.ready.then(() => {
      if (disposed || !client.grid || !client.texture) return;
      surface = createWaterSurface(client.grid, client.texture);
      scene.add(surface.mesh);
      if (import.meta.env.DEV) Object.assign((window as unknown as { __mill: object }).__mill ?? {}, { water: client, waterParams: surface.params });
    });

    const onKey = (e: KeyboardEvent) => {
      const speedKey = ['Digit0', 'Digit1', 'Digit2', 'Digit3'].indexOf(e.code);
      if (speedKey >= 0) client.speed = SPEEDS[speedKey];
      if (e.code === 'BracketLeft') client.setDischarge(client.discharge - 2);
      if (e.code === 'BracketRight') client.setDischarge(client.discharge + 2);
      if (e.code === 'KeyR') client.reset(false);
      if (e.code === 'KeyF') client.reset(true);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      disposed = true;
      window.removeEventListener('keydown', onKey);
      if (surface) scene.remove(surface.mesh);
      client.dispose();
      water.current = null;
    };
  }, [scene]);

  useEffect(() => {
    const cam = camera as PerspectiveCamera;
    cam.fov = 28;
    cam.near = 0.5;
    cam.far = 2000;
    cam.position.set(...CAMERA_START.position);
    cam.updateProjectionMatrix();
    const controls = new OrbitControls(cam, renderer.domElement);
    controls.target.set(...CAMERA_START.target);
    controls.enableDamping = true;
    controls.maxPolarAngle = 1.45;
    controls.update();

    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'KeyC') site.cutaway.visible = !site.cutaway.visible;
      if (e.code === 'KeyE') ink.edgesOn.value = ink.edgesOn.value ? 0 : 1;
      if (e.code === 'KeyH') ink.hatchOn.value = ink.hatchOn.value ? 0 : 1;
      if (e.code === 'KeyT') ink.showTone.value = ink.showTone.value ? 0 : 1;
      if (e.code === 'KeyS') washShadows.value = washShadows.value ? 0 : 1;
    };
    window.addEventListener('keydown', onKey);

    if (import.meta.env.DEV) {
      (window as unknown as Record<string, unknown>).__mill = { camera: cam, controls, site, ink, tone: toneGain, washShadows, MILL, WHEEL };
    }
    (camera.userData as { controls?: OrbitControls }).controls = controls;
    return () => {
      window.removeEventListener('keydown', onKey);
      controls.dispose();
    };
  }, [camera, renderer, site, ink]);

  // Priority 1 takes over rendering from R3F so the ink pipeline draws the frame.
  const hudTimer = useRef(0);
  useFrame((_, delta) => {
    inkTime.value += delta;
    site.wheelSpin.rotation.z += delta * 0.9;
    const client = water.current;
    if (client) {
      client.update(delta);
      site.spillSheet.visible = (client.stats?.spill ?? 0) > 0.2;
      hudTimer.current += delta;
      if (onWater && hudTimer.current > 0.25) {
        hudTimer.current = 0;
        onWater({ stats: client.stats, speed: client.speed, discharge: client.discharge, error: client.error });
      }
    }
    (camera.userData as { controls?: OrbitControls }).controls?.update();
    ink.pipeline.render();
  }, 1);

  return null;
}
