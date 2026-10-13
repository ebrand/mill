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
import type { GameActions } from '../game/actions';
import type { PlacementController } from '../mill/placement';
import type { LevelController } from '../tools/levelTool';
import type { PlanBook } from '../plan/planBook';
import type { ConstructionController } from '../build/constructionController';
import { PlanGhosts } from '../plan/planGhosts';
import { newStructureId } from '../mill/structures';
import { applyChannel, planChannel, writeHeights } from '../tools/channel';
import { planEmbankment } from '../tools/embankment';
import { planWheelPit } from '../tools/pit';
import { MILL_LINK_ID, siteMillStructure } from '../mill/siteMill';
import { StructureMeshes } from '../mill/structureMeshes';
import type { StructuresController } from '../mill/structuresController';
import { incompatibility, readSave, SAVE_VERSION, writeSave } from '../save/saveGame';
import { EarthLedger, EditHistory } from '../world/editHistory';
import { createSiteField } from '../world/siteField';
import type { Rect } from '../world/terrainField';
import { buildSite } from './buildSite';
import { MILL, type SiteStart, WHEEL } from './site';

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
  actions,
  structures,
  gatePlan,
  wheelPlan,
  level,
  plans,
  construction,
  start = 'valley',
  autoLoad = false,
  onSwitchStart,
}: {
  onWater?: (hud: WaterHud) => void;
  tool?: Tool;
  channel?: ChannelController;
  bank?: EmbankmentController;
  actions?: GameActions;
  structures?: StructuresController;
  gatePlan?: PlacementController;
  wheelPlan?: PlacementController;
  level?: LevelController;
  plans?: PlanBook;
  construction?: ConstructionController;
  /** Which site to start from. */
  start?: SiteStart;
  /** Load the saved game as soon as the scene is ready (used when Load switches start). */
  autoLoad?: boolean;
  /** A save from the other start was loaded: rebuild for that start, then load. */
  onSwitchStart?: (start: SiteStart) => void;
}) {
  const { scene, camera, gl } = useThree();
  const renderer = gl as unknown as WebGPURenderer;
  const water = useRef<WaterClient | null>(null);
  const brush = useRef<EarthBrush | null>(null);
  const channelView = useRef<PathView | null>(null);
  const bankView = useRef<PathView | null>(null);

  // The one editable terrain: rendered, simulated over, and dug.
  const field = useMemo(() => createSiteField(WATER_DX, start), [start]);
  const site = useMemo(() => buildSite(field, start), [field, start]);
  const ledger = useMemo(() => new EarthLedger(), []);
  const history = useMemo(() => new EditHistory(field, ledger), [field, ledger]);

  /** Push a changed rectangle of terrain to the meshes and the water sim. */
  const applyRect = (rect: Rect) => {
    site.terrain.update(rect);
    water.current?.updateBed(rect);
  };
  const refreshUndo = () =>
    actions?.setStatus({
      undoLabel: history.canUndo ? history.undoLabel : null,
      redoLabel: history.canRedo ? history.redoLabel : null,
    });
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
    const client = new WaterClient({ terrain: field, prefill: true, start });
    water.current = client;
    let surface: ReturnType<typeof createWaterSurface> | null = null;
    let disposed = false;
    client.ready.then(() => {
      if (disposed || !client.grid || !client.texture) return;
      surface = createWaterSurface(client.grid, client.texture);
      scene.add(surface.mesh);
      structures?.attach(client.grid, { setLink: (link) => client.setLink(link), removeLink: (id) => client.removeLink(id) });
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
  }, [scene, field, structures]);

  // Earthworks brush. Edits reach the water sim through the client, whichever is current.
  useEffect(() => {
    const b = new EarthBrush(field, site.terrain, renderer.domElement, (rect) => water.current?.updateBed(rect), history, refreshUndo);
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
  }, [scene, renderer, field, site, history]);

  // Channel planning: the controller (shared with the UI panel) works on our terrain; the
  // view draws the proposal and handles clicks on the ground.
  useEffect(() => {
    if (!channel) return;
    channel.env = {
      field,
      water: () => water.current,
      beforeCommit: (rect, label) => {
        history.begin(label);
        history.touch(rect);
      },
      onCommit: (result) => {
        history.record(result.cut, result.fill);
        history.end();
        applyRect(result.rect);
        refreshUndo();
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
  }, [channel, field, site, renderer, scene, camera, history]);

  // Bank (embankment) planning, the same way.
  useEffect(() => {
    if (!bank) return;
    bank.env = {
      field,
      water: () => water.current,
      beforeCommit: (rect, label) => {
        history.begin(label);
        history.touch(rect);
      },
      onCommit: (result) => {
        history.record(0, result.fill);
        history.end();
        applyRect(result.rect);
        refreshUndo();
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
  }, [bank, field, site, renderer, scene, camera, history]);

  // Undo/redo and save/load, exposed to the toolbar through `actions` and to the keyboard.
  useEffect(() => {
    if (!actions) return;
    const SLOT = 'slot1';
    actions.undo = () => {
      const rect = history.undo();
      if (rect) applyRect(rect);
      refreshUndo();
    };
    actions.redo = () => {
      const rect = history.redo();
      if (rect) applyRect(rect);
      refreshUndo();
    };
    actions.save = async () => {
      const client = water.current;
      try {
        const snap = client ? await client.snapshot() : null;
        await writeSave(SLOT, {
          version: SAVE_VERSION,
          savedAt: Date.now(),
          start,
          spec: field.spec,
          heights: field.heights.slice(),
          material: field.material.slice(),
          depth: snap?.depth ?? null,
          simTime: snap?.time ?? 0,
          discharge: client?.discharge ?? 0,
          cut: ledger.cut,
          fill: ledger.fill,
          structures: structures?.structures.map((s) => ({ ...s })),
          plans: plans?.items.map((i) => ({ ...i })),
          construction: construction?.save(),
        });
        actions.setStatus({ message: `Saved at ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`, hasSave: true });
      } catch (err) {
        actions.setStatus({ message: `Save failed: ${err instanceof Error ? err.message : err}` });
      }
    };
    actions.load = async () => {
      try {
        const save = await readSave(SLOT);
        if (!save) {
          actions.setStatus({ message: 'No saved game' });
          return;
        }
        const saveStart = save.start ?? 'oldMill';
        if (saveStart !== start) {
          onSwitchStart?.(saveStart);
          return;
        }
        const problem = incompatibility(save, field);
        if (problem) {
          actions.setStatus({ message: `Can't load: ${problem}` });
          return;
        }
        field.heights.set(save.heights);
        field.material.set(save.material);
        site.terrain.update({ i0: 0, j0: 0, i1: field.nx, j1: field.nz });
        ledger.cut = save.cut;
        ledger.fill = save.fill;
        history.clear();
        channel?.clear();
        bank?.clear();
        water.current?.restart({ prefill: save.depth === null, depth: save.depth ?? undefined, time: save.simTime, discharge: save.discharge });
        plans?.restore(save.plans ?? []);
        construction?.restore(save.construction);
        if (structures) {
          if (save.structures) structures.restore(save.structures);
          else if (save.mill) structures.restore([siteMillStructure(save.mill.gate, save.mill.lumber)]);
        }
        refreshUndo();
        actions.setStatus({ message: `Loaded game saved ${new Date(save.savedAt).toLocaleString()}` });
      } catch (err) {
        actions.setStatus({ message: `Load failed: ${err instanceof Error ? err.message : err}` });
      }
    };
    readSave(SLOT).then(
      (s) => actions.setStatus({ hasSave: !!s }),
      () => actions.setStatus({ hasSave: false }),
    );
    if (autoLoad) void actions.load();
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e) || !(e.ctrlKey || e.metaKey)) return;
      if (e.code === 'KeyZ' && !e.shiftKey) actions.undo();
      else if ((e.code === 'KeyZ' && e.shiftKey) || e.code === 'KeyY') actions.redo();
      else if (e.code === 'KeyS') actions.save();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    devExpose({ actions, history, ledger });
    return () => window.removeEventListener('keydown', onKey);
  }, [actions, field, site, history, ledger, channel, bank, structures, plans, construction, start, autoLoad]);

  // The works plan: build items on request (recomputed against today's ground), and draw
  // the rest as ghosts.
  const planGhosts = useRef<PlanGhosts | null>(null);
  useEffect(() => {
    if (!plans) return;
    /** One undoable edit: snapshot, write, account, push to meshes and water. */
    const edit = (label: string, rect: Rect, write: () => void, cut: number, fill: number) => {
      history.begin(label);
      history.touch(rect);
      write();
      history.record(cut, fill);
      history.end();
      applyRect(rect);
      refreshUndo();
    };
    plans.env = {
      field,
      usedLabels: () => [
        ...(structures?.structures.map((s) => s.name) ?? []),
        ...(construction?.site.jobs.map((j) => j.item.label) ?? []),
      ],
      build: (item) => {
        const input = item.input;
        if (input.kind === 'channel') {
          const r = planChannel(field, input.plan);
          edit(item.label, r.rect, () => applyChannel(field, r), r.cut, r.fill);
          return true;
        }
        if (input.kind === 'bank') {
          const r = planEmbankment(field, input.plan);
          edit(item.label, r.rect, () => writeHeights(field, r.rect, r.heights), 0, r.fill);
          return true;
        }
        if (!structures) return false;
        const s = { ...input.structure, id: newStructureId(input.structure.kind), name: item.label };
        if (s.kind === 'wheel') {
          const pit = planWheelPit(field, s);
          edit(`${item.label} pit`, pit.rect, () => writeHeights(field, pit.rect, pit.heights), pit.cut, 0);
        }
        structures.add(s);
        return true;
      },
    };
    const ghosts = new PlanGhosts(plans, field);
    planGhosts.current = ghosts;
    scene.add(ghosts.group);
    devExpose({ plans });
    return () => {
      scene.remove(ghosts.group);
      planGhosts.current = null;
      plans.env = null;
    };
  }, [plans, field, scene, history, structures, construction]);

  // Construction over calendar days: earthworks reshape the ground a little each day (so the
  // river responds while the work goes on), and structures go up when their job is done.
  useEffect(() => {
    if (!construction) return;
    construction.env = {
      field,
      earthwork: (item) => {
        const input = item.input;
        if (input.kind === 'channel') {
          const r = planChannel(field, input.plan);
          return { rect: r.rect, heights: r.heights };
        }
        if (input.kind === 'bank') {
          const r = planEmbankment(field, input.plan);
          return { rect: r.rect, heights: r.heights };
        }
        if (input.structure.kind === 'wheel' && input.structure.pit) {
          const pit = planWheelPit(field, input.structure);
          return { rect: pit.rect, heights: pit.heights };
        }
        return null;
      },
      onTerrain: (rect) => {
        applyRect(rect);
        // Construction reshapes the ground outside the undo history; undoing an older manual
        // edit across it would corrupt the ground, so the history starts afresh.
        if (history.canUndo || history.canRedo) {
          history.clear();
          refreshUndo();
        }
      },
      onComplete: (item) => {
        const input = item.input;
        if (input.kind === 'structure' && structures) {
          structures.add({ ...input.structure, id: newStructureId(input.structure.kind), name: item.label });
        }
        plans?.reestimate();
      },
    };
    construction.produce = (days) => structures?.accrueDays(days) ?? 0;
    devExpose({ construction });
    return () => {
      construction.env = null;
      construction.produce = null;
    };
  }, [construction, field, history, structures, plans]);

  // The surveyor's level.
  const levelView = useRef<PathView | null>(null);
  useEffect(() => {
    if (!level) return;
    level.env = { field, water: () => water.current };
    const view = new PathView(level, field, renderer.domElement, () => camera);
    levelView.current = view;
    scene.add(view.group);
    devExpose({ level });
    return () => {
      scene.remove(view.group);
      view.dispose();
      levelView.current = null;
      level.env = null;
    };
  }, [level, field, renderer, scene, camera]);

  // Placing gates and wheels, and drawing the ones built.
  const gateView = useRef<PathView | null>(null);
  const wheelView = useRef<PathView | null>(null);
  const structureMeshes = useRef<StructureMeshes | null>(null);
  useEffect(() => {
    if (!structures) return;
    const meshes = new StructureMeshes(structures, field);
    structureMeshes.current = meshes;
    scene.add(meshes.group);
    const views: PathView[] = [];
    for (const [plan, ref] of [
      [gatePlan, gateView],
      [wheelPlan, wheelView],
    ] as const) {
      if (!plan) continue;
      plan.env = {
        field,
        water: () => water.current,
        onBuild: (s) => structures.add(s),
        beforeDig: (rect, label) => {
          history.begin(label);
          history.touch(rect);
        },
        onDig: (pit) => {
          history.record(pit.cut, 0);
          history.end();
          applyRect(pit.rect);
          refreshUndo();
        },
      };
      const view = new PathView(plan, field, renderer.domElement, () => camera);
      ref.current = view;
      views.push(view);
      scene.add(view.group);
    }
    devExpose({ structures, gatePlan, wheelPlan });
    return () => {
      scene.remove(meshes.group);
      structureMeshes.current = null;
      for (const v of views) {
        scene.remove(v.group);
        v.dispose();
      }
      gateView.current = null;
      wheelView.current = null;
      if (gatePlan) gatePlan.env = null;
      if (wheelPlan) wheelPlan.env = null;
    };
  }, [structures, gatePlan, wheelPlan, field, scene, renderer, camera, history]);

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
      if (e.code === 'KeyC' && site.oldWorks) site.oldWorks.cutaway.visible = !site.oldWorks.cutaway.visible;
      if (e.code === 'KeyE') ink.edgesOn.value = ink.edgesOn.value ? 0 : 1;
      if (e.code === 'KeyH') ink.hatchOn.value = ink.hatchOn.value ? 0 : 1;
      if (e.code === 'KeyT') ink.showTone.value = ink.showTone.value ? 0 : 1;
      if (e.code === 'KeyS' && !e.ctrlKey && !e.metaKey) washShadows.value = washShadows.value ? 0 : 1;
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
  const lastStats = useRef<SimStats | null>(null);
  useFrame((_, delta) => {
    inkTime.value += delta;
    // The old mill's wheel turns with the water through it: about 7 rpm at full bucket capacity.
    const flow = structures?.dischargeOf(MILL_LINK_ID) ?? 0;
    const speed = water.current?.speed ?? 1;
    if (site.oldWorks) {
      site.oldWorks.wheelSpin.rotation.z += delta * speed * 0.75 * Math.min(1, flow / 2.5);
      site.oldWorks.flumeWater.visible = flow > 0.05;
    }
    structureMeshes.current?.update(delta, speed);
    planGhosts.current?.update();
    construction?.update(delta);
    if (level && levelView.current) {
      level.update(performance.now());
      levelView.current.active = tool === 'level';
      levelView.current.update();
    }
    for (const [plan, view, kind] of [
      [gatePlan, gateView.current, 'gate'],
      [wheelPlan, wheelView.current, 'wheel'],
    ] as const) {
      if (!plan || !view) continue;
      plan.update(performance.now());
      view.active = tool === kind;
      view.update();
    }
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
      if (structures && client.stats && client.stats !== lastStats.current) {
        lastStats.current = client.stats;
        structures.update(client.stats, performance.now());
      }
      if (site.oldWorks) site.oldWorks.spillSheet.visible = (client.stats?.spill ?? 0) > 0.2;
      hudTimer.current += delta;
      if (onWater && hudTimer.current > 0.25) {
        hudTimer.current = 0;
        const b = brush.current;
        onWater({
          stats: client.stats,
          speed: client.speed,
          discharge: client.discharge,
          error: client.error,
          earth: { tool: b?.tool ?? 'look', radius: b?.radius ?? 0, cut: ledger.cut, fill: ledger.fill },
        });
      }
    }
    (camera.userData as { controls?: OrbitControls }).controls?.update();
    ink.pipeline.render();
  }, 1);

  return null;
}
