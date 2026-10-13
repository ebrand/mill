import { Canvas } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { GameActions } from './game/actions';
import { PlacementController } from './mill/placement';
import { PlanBook } from './plan/planBook';
import { ConstructionController } from './build/constructionController';
import { StructuresController } from './mill/structuresController';
import { isTyping } from './debug/devExpose';
import { ChannelController } from './tools/channelTool';
import { LevelController } from './tools/levelTool';
import { EmbankmentController } from './tools/embankmentTool';
import type { Tool } from './tools/earthBrush';
import { CalendarBar } from './ui/CalendarBar';
import { ChannelPanel } from './ui/ChannelPanel';
import { EmbankmentPanel } from './ui/EmbankmentPanel';
import { LevelPanel } from './ui/LevelPanel';
import { PlacementPanel } from './ui/PlacementPanel';
import { StructuresPanel } from './ui/StructuresPanel';
import { WorksPlanPanel } from './ui/WorksPlanPanel';
import { WebGPURenderer } from 'three/webgpu';
import type { SiteStart } from './scene/site';
import { StyleTest, type WaterHud } from './scene/StyleTest';

const CUBIC_YARDS_PER_M3 = 1.30795;

function formatHud({ stats, speed, discharge, error, earth }: WaterHud): string {
  if (error) return `Water sim error: ${error}`;
  if (!stats) return 'Water: starting…';
  const t = stats.time;
  const clock = `${Math.floor(t / 3600)}h ${String(Math.floor((t % 3600) / 60)).padStart(2, '0')}m`;
  return [
    `River ${clock} · ${speed === 0 ? 'paused' : `${speed}×`}`,
    `inflow ${discharge.toFixed(0)} m³/s · over dam ${stats.spill.toFixed(1)} · leaving ${stats.outflow.toFixed(1)}`,
    `water at the ledge ${stats.pondLevel.toFixed(2)} m · stored ${(stats.volume / 1000).toFixed(1)}k m³ · ${stats.stepMs.toFixed(1)} ms (${stats.steps} steps)`,
    `earth moved: cut ${(earth.cut * CUBIC_YARDS_PER_M3).toFixed(0)} yd³ · fill ${(earth.fill * CUBIC_YARDS_PER_M3).toFixed(0)} yd³` +
      (earth.tool === 'look' ? '' : ` · brush ${earth.radius.toFixed(1)} m`),
  ].join('\n');
}

const TOOLS: { id: Tool; label: string; key: string }[] = [
  { id: 'look', label: 'Look', key: 'Escape' },
  { id: 'level', label: 'Level', key: 'KeyL' },
  { id: 'dig', label: 'Dig', key: 'KeyG' },
  { id: 'fill', label: 'Fill', key: 'KeyV' },
  { id: 'channel', label: 'Channel', key: 'KeyN' },
  { id: 'bank', label: 'Bank', key: 'KeyB' },
  { id: 'gate', label: 'Gate', key: 'KeyU' },
  { id: 'wheel', label: 'Wheel', key: 'KeyW' },
];

interface GameScreenProps {
  start: SiteStart;
  autoLoad: boolean;
  onNewGame: (start: SiteStart) => void;
  onSwitchStart: (start: SiteStart) => void;
}

/** Choose how to begin: the untouched valley (the game), or the old mill demo. */
function NewGameDialog({ onChoose, onCancel }: { onChoose: (start: SiteStart) => void; onCancel: () => void }) {
  const button = { font: '14px Georgia, serif', padding: '6px 12px', color: '#2b2620', background: '#f1e9d8', border: '1px solid #2b2620', borderRadius: 2, cursor: 'pointer' } as const;
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(43,38,32,0.25)', display: 'grid', placeItems: 'center', zIndex: 10 }}>
      <div style={{ width: 380, padding: '16px 18px', background: '#f1e9d8', border: '1px solid #2b2620', font: '14px Georgia, serif', color: '#2b2620', display: 'grid', gap: 10 }}>
        <strong style={{ fontSize: 16 }}>Begin again</strong>
        <div>Anything not saved will be lost. Your saved game stays as it is until you save over it.</div>
        <button style={button} onClick={() => onChoose('valley')}>
          <strong>The valley</strong> — an untouched river: no dam, no mill. Survey, plan and build from nothing.
        </button>
        <button style={button} onClick={() => onChoose('oldMill')}>
          <strong>The old mill</strong> — a working mill and dam already standing (a demonstration site).
        </button>
        <button style={{ ...button, justifySelf: 'end' }} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

export function App() {
  // Each game is a fresh GameScreen (new terrain, sim, controllers); `id` forces the remount.
  const [game, setGame] = useState<{ id: number; start: SiteStart; autoLoad: boolean }>({ id: 0, start: 'valley', autoLoad: false });
  if (!('gpu' in navigator)) {
    return <div style={{ padding: 24 }}>This game needs WebGPU, which this browser does not provide.</div>;
  }
  return (
    <GameScreen
      key={game.id}
      start={game.start}
      autoLoad={game.autoLoad}
      onNewGame={(start) => setGame((g) => ({ id: g.id + 1, start, autoLoad: false }))}
      onSwitchStart={(start) => setGame((g) => ({ id: g.id + 1, start, autoLoad: true }))}
    />
  );
}

function GameScreen({ start, autoLoad, onNewGame, onSwitchStart }: GameScreenProps) {
  const hudRef = useRef<HTMLPreElement>(null);
  const [newGame, setNewGame] = useState(false);
  const [tool, setTool] = useState<Tool>('look');
  const channel = useMemo(() => new ChannelController(), []);
  const bank = useMemo(() => new EmbankmentController(), []);
  const actions = useMemo(() => new GameActions(), []);
  const structures = useMemo(() => new StructuresController(start === 'oldMill'), [start]);
  const gatePlan = useMemo(() => new PlacementController('gate'), []);
  const wheelPlan = useMemo(() => new PlacementController('wheel'), []);
  const level = useMemo(() => new LevelController(), []);
  const plans = useMemo(() => new PlanBook(), []);
  const construction = useMemo(() => new ConstructionController(), []);
  const [showPlan, setShowPlan] = useState(true);
  // Sandbox: instant tools and no money. Off is the game: plan, hire, build over time.
  const [sandbox, setSandbox] = useState(false);
  const sandboxRef = useRef(sandbox);
  sandboxRef.current = sandbox;
  const tools = TOOLS.filter((t) => sandbox || (t.id !== 'dig' && t.id !== 'fill'));
  useEffect(() => {
    if (!sandbox && (tool === 'dig' || tool === 'fill')) setTool('look');
  }, [sandbox, tool]);
  const [showMill, setShowMill] = useState(true);
  const status = useSyncExternalStore(actions.subscribe, actions.getSnapshot);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Typing in the channel panel's fields shouldn't switch tools.
      if (isTyping(e)) return;
      if (e.code === 'KeyM' && !e.ctrlKey && !e.metaKey) setShowMill((v) => !v);
      if (e.code === 'KeyP' && !e.ctrlKey && !e.metaKey) setShowPlan((v) => !v);
      // (Not on a focused button: Space would click it as well.)
      if (e.code === 'Space' && !(e.target instanceof HTMLButtonElement)) {
        e.preventDefault();
        construction.setSpeed(construction.speedIndex === 0 ? 2 : 0);
      }
      const t = TOOLS.find((t) => t.key === e.code && (sandboxRef.current || (t.id !== 'dig' && t.id !== 'fill')));
      if (t) setTool(t.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const onWater = (hud: WaterHud) => {
    if (hudRef.current) hudRef.current.textContent = formatHud(hud);
  };
  return (
    <>
      <Canvas
        gl={async (props) => {
          const renderer = new WebGPURenderer({ ...(props as object), antialias: false });
          await renderer.init();
          return renderer;
        }}
      >
        <StyleTest
          onWater={onWater}
          tool={tool}
          channel={channel}
          bank={bank}
          actions={actions}
          structures={structures}
          gatePlan={gatePlan}
          wheelPlan={wheelPlan}
          level={level}
          plans={plans}
          construction={construction}
          start={start}
          autoLoad={autoLoad}
          onSwitchStart={onSwitchStart}
        />
      </Canvas>
      {tool === 'channel' && <ChannelPanel controller={channel} plans={plans} sandbox={sandbox} />}
      {tool === 'bank' && <EmbankmentPanel controller={bank} plans={plans} sandbox={sandbox} />}
      {tool === 'level' && <LevelPanel controller={level} />}
      {tool === 'gate' && <PlacementPanel controller={gatePlan} plans={plans} sandbox={sandbox} />}
      {tool === 'wheel' && <PlacementPanel controller={wheelPlan} plans={plans} sandbox={sandbox} />}
      {showPlan && <WorksPlanPanel plans={plans} construction={construction} sandbox={sandbox} />}
      <CalendarBar construction={construction} />
      {newGame && (
        <NewGameDialog
          onChoose={(s) => {
            setNewGame(false);
            onNewGame(s);
          }}
          onCancel={() => setNewGame(false)}
        />
      )}
      {showMill && <StructuresPanel controller={structures} construction={construction} />}
      <div style={{ position: 'fixed', top: 14, left: 16, display: 'flex', gap: 6, font: '14px Georgia, serif' }}>
        {tools.map((t) => (
          <button
            key={t.id}
            onClick={() => setTool(t.id)}
            style={{
              font: 'inherit',
              padding: '4px 12px',
              color: '#2b2620',
              background: tool === t.id ? '#d9cdb4' : '#f1e9d8',
              border: '1px solid #2b2620',
              borderRadius: 2,
              cursor: 'pointer',
            }}
          >
            {t.label}
          </button>
        ))}
        <span style={{ width: 12 }} />
        {(
          [
            ['Undo', () => actions.undo(), !status.undoLabel, status.undoLabel ? `Undo ${status.undoLabel} (Ctrl/Cmd+Z)` : 'Nothing to undo'],
            ['Redo', () => actions.redo(), !status.redoLabel, status.redoLabel ? `Redo ${status.redoLabel} (Ctrl/Cmd+Shift+Z)` : 'Nothing to redo'],
            ['Save', () => actions.save(), false, 'Save the game (Ctrl/Cmd+S)'],
            ['Load', () => actions.load(), !status.hasSave, status.hasSave ? 'Load the saved game' : 'No saved game yet'],
          ] as const
        ).map(([label, run, disabled, title]) => (
          <button
            key={label}
            onClick={run}
            disabled={disabled}
            title={title}
            style={{
              font: 'inherit',
              padding: '4px 12px',
              color: '#2b2620',
              background: '#f1e9d8',
              border: '1px solid #2b2620',
              borderRadius: 2,
              cursor: disabled ? 'default' : 'pointer',
              opacity: disabled ? 0.45 : 1,
            }}
          >
            {label}
          </button>
        ))}
        <span style={{ width: 12 }} />
        <button
          onClick={() => setNewGame(true)}
          title="Start over"
          style={{
            font: 'inherit',
            padding: '4px 12px',
            color: '#2b2620',
            background: '#f1e9d8',
            border: '1px solid #2b2620',
            borderRadius: 2,
            cursor: 'pointer',
          }}
        >
          New game
        </button>
        <button
          onClick={() => setSandbox((v) => !v)}
          title="Sandbox: instant tools, no money or time. Off: plan, hire crews, build over days."
          style={{
            font: 'inherit',
            padding: '4px 12px',
            color: '#2b2620',
            background: sandbox ? '#d9cdb4' : '#f1e9d8',
            border: '1px solid #2b2620',
            borderRadius: 2,
            cursor: 'pointer',
          }}
        >
          Sandbox
        </button>
        <button
          onClick={() => setShowPlan((v) => !v)}
          title="Show or hide the works plan (P)"
          style={{
            font: 'inherit',
            padding: '4px 12px',
            color: '#2b2620',
            background: showPlan ? '#d9cdb4' : '#f1e9d8',
            border: '1px solid #2b2620',
            borderRadius: 2,
            cursor: 'pointer',
          }}
        >
          Plan
        </button>
        <button
          onClick={() => setShowMill((v) => !v)}
          title="Show or hide the mill panel (M)"
          style={{
            font: 'inherit',
            padding: '4px 12px',
            color: '#2b2620',
            background: showMill ? '#d9cdb4' : '#f1e9d8',
            border: '1px solid #2b2620',
            borderRadius: 2,
            cursor: 'pointer',
          }}
        >
          Mill
        </button>
        {status.message && <span style={{ alignSelf: 'center', marginLeft: 8, color: '#2b2620' }}>{status.message}</span>}
      </div>
      <div
        style={{
          position: 'fixed',
          left: 16,
          bottom: 14,
          font: '13px Georgia, serif',
          color: '#3a332b',
          pointerEvents: 'none',
        }}
      >
        <pre ref={hudRef} style={{ font: 'inherit', margin: '0 0 6px' }} />
        Drag to orbit · scroll to zoom · C cutaway · S shadow style · E outlines · H hatching
        <br />
        River: 0 pause · 1 real time · 2 4× · 3 16× · [ ] inflow · R restart dry · F restart filled
        <br />
        Earth: L level · G dig · V fill (sandbox) · N channel · B bank · U gate · W wheel · Esc look · hold left button to work · right-drag orbits while a tool is on · , . brush size
      </div>
    </>
  );
}
