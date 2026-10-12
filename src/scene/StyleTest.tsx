import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { AmbientLight, DirectionalLight, MOUSE, NoToneMapping, type PerspectiveCamera } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { WebGPURenderer } from 'three/webgpu';
import { devExpose, isTyping } from '../debug/devExpose';
import { inkTime, lighting, toneGain, washShadows } from '../ink/materials';
import { createInkPipeline } from '../ink/pipeline';
import type { ChannelController } from '../tools/channelTool';
import type { EmbankmentController } from '../tools/embankmentTool';
import { PathView } from '../tools/pathView';
import { BRUSH_RADIUS, EarthBrush, type Tool } from '../tools/earthBrush';
import type { SimStats } from '../water/protocol';
import { WaterClient } from '../water/WaterClient';
import { createWaterSurface } from '../water/waterSurface';
import { createSiteField } from '../world/siteField';
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
  earth: { tool: Tool; radius: number; cut: number; fill: number };
}

/** The pen-and-ink site with the simulated river and earthworks. */
export function StyleTest({
  onWater,
  tool = 'look',
  channel,
  bank,
}: {
  onWater?: (hud: WaterHud) => void;
  tool?: Tool;
  channel?: ChannelController;
  bank?: EmbankmentController;
}) {
  const { scene, camera, gl } = useThree();
  const renderer = gl as unknown as WebGPURenderer;
  const water = useRef<WaterClient | null>(null);
  const brush = useRef<EarthBrush | null>(null);
  const channelView = useRef<PathView | null>(null);
  const bankView = useRef<PathView | null>(null);

  // The one editable terrain: rendered, simulated over, and dug.
  const field = useMemo(() => createSiteField(WATER_DX), []);
  const site = useMemo(() => buildSite(field), [field]);
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
    const client = new WaterClient({ terrain: field, prefill: true });
    water.current = client;
    let surface: ReturnType<typeof createWaterSurface> | null = null;
    let disposed = false;
    client.ready.then(() => {
      if (disposed || !client.grid || !client.texture) return;
      surface = createWaterSurface(client.grid, client.texture);
      scene.add(surface.mesh);
      devExpose({ water: client, waterParams: surface.params });
    });

    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e)) return;
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
  }, [scene, field]);

  // Earthworks brush. Edits reach the water sim through the client, whichever is current.
  useEffect(() => {
    const b = new EarthBrush(field, site.terrain, renderer.domElement, (rect) => water.current?.updateBed(rect));
    brush.current = b;
    scene.add(b.ring);
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e)) return;
      if (e.code === 'Comma') b.radius = Math.max(BRUSH_RADIUS.min, b.radius / 1.25);
      if (e.code === 'Period') b.radius = Math.min(BRUSH_RADIUS.max, b.radius * 1.25);
    };
    window.addEventListener('keydown', onKey);
    devExpose({ brush: b, field });
    return () => {
      window.removeEventListener('keydown', onKey);
      scene.remove(b.ring);
      b.dispose();
      brush.current = null;
    };
  }, [scene, renderer, field, site]);

  // Channel planning: the controller (shared with the UI panel) works on our terrain; the
  // view draws the proposal and handles clicks on the ground.
  useEffect(() => {
    if (!channel) return;
    channel.env = {
      field,
      water: () => water.current,
      onCommit: (result) => {
        site.terrain.update(result.rect);
        water.current?.updateBed(result.rect);
        if (brush.current) {
          brush.current.cut += result.cut;
          brush.current.fill += result.fill;
        }
      },
    };
    const view = new PathView(channel, field, renderer.domElement, () => camera);
    channelView.current = view;
    scene.add(view.group);
    devExpose({ channel, channelView: view });
    return () => {
      scene.remove(view.group);
      view.dispose();
      channelView.current = null;
      channel.env = null;
    };
  }, [channel, field, site, renderer, scene, camera]);

  // Bank (embankment) planning, the same way.
  useEffect(() => {
    if (!bank) return;
    bank.env = {
      field,
      water: () => water.current,
      onCommit: (result) => {
        site.terrain.update(result.rect);
        water.current?.updateBed(result.rect);
        if (brush.current) brush.current.fill += result.fill;
      },
    };
    const view = new PathView(bank, field, renderer.domElement, () => camera);
    bankView.current = view;
    scene.add(view.group);
    devExpose({ bank, bankView: view });
    return () => {
      scene.remove(view.group);
      view.dispose();
      bankView.current = null;
      bank.env = null;
    };
  }, [bank, field, site, renderer, scene, camera]);

  // With a tool active, the left button works the ground; orbit moves to the right button.
  useEffect(() => {
    brush.current?.setTool(tool);
    if (channelView.current) channelView.current.active = tool === 'channel';
    if (bankView.current) bankView.current.active = tool === 'bank';
    const controls = (camera.userData as { controls?: OrbitControls }).controls;
    if (controls) {
      controls.mouseButtons.LEFT = tool === 'look' ? MOUSE.ROTATE : (-1 as MOUSE);
      controls.mouseButtons.RIGHT = tool === 'look' ? MOUSE.PAN : MOUSE.ROTATE;
    }
  }, [tool, camera]);

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
      if (isTyping(e)) return;
      if (e.code === 'KeyC') site.cutaway.visible = !site.cutaway.visible;
      if (e.code === 'KeyE') ink.edgesOn.value = ink.edgesOn.value ? 0 : 1;
      if (e.code === 'KeyH') ink.hatchOn.value = ink.hatchOn.value ? 0 : 1;
      if (e.code === 'KeyT') ink.showTone.value = ink.showTone.value ? 0 : 1;
      if (e.code === 'KeyS') washShadows.value = washShadows.value ? 0 : 1;
    };
    window.addEventListener('keydown', onKey);

    devExpose({ camera: cam, controls, site, ink, tone: toneGain, washShadows, MILL, WHEEL });
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
    brush.current?.update(delta, camera);
    if (channel) channel.update(performance.now());
    if (channelView.current) {
      channelView.current.active = tool === 'channel';
      channelView.current.update();
    }
    if (bank) bank.update(performance.now());
    if (bankView.current) {
      bankView.current.active = tool === 'bank';
      bankView.current.update();
    }
    const client = water.current;
    if (client) {
      client.update(delta);
      site.spillSheet.visible = (client.stats?.spill ?? 0) > 0.2;
      hudTimer.current += delta;
      if (onWater && hudTimer.current > 0.25) {
        hudTimer.current = 0;
        const b = brush.current;
        onWater({
          stats: client.stats,
          speed: client.speed,
          discharge: client.discharge,
          error: client.error,
          earth: { tool: b?.tool ?? 'look', radius: b?.radius ?? 0, cut: b?.cut ?? 0, fill: b?.fill ?? 0 },
        });
      }
    }
    (camera.userData as { controls?: OrbitControls }).controls?.update();
    ink.pipeline.render();
  }, 1);

  return null;
}
