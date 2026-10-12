import { Canvas } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import { isTyping } from './debug/devExpose';
import { ChannelController } from './tools/channelTool';
import type { Tool } from './tools/earthBrush';
import { ChannelPanel } from './ui/ChannelPanel';
import { WebGPURenderer } from 'three/webgpu';
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
    `pond ${stats.pondLevel.toFixed(2)} m · stored ${(stats.volume / 1000).toFixed(1)}k m³ · ${stats.stepMs.toFixed(1)} ms (${stats.steps} steps)`,
    `earth moved: cut ${(earth.cut * CUBIC_YARDS_PER_M3).toFixed(0)} yd³ · fill ${(earth.fill * CUBIC_YARDS_PER_M3).toFixed(0)} yd³` +
      (earth.tool === 'look' ? '' : ` · brush ${earth.radius.toFixed(1)} m`),
  ].join('\n');
}

const TOOLS: { id: Tool; label: string; key: string }[] = [
  { id: 'look', label: 'Look', key: 'Escape' },
  { id: 'dig', label: 'Dig', key: 'KeyG' },
  { id: 'fill', label: 'Fill', key: 'KeyV' },
  { id: 'channel', label: 'Channel', key: 'KeyN' },
];

export function App() {
  const hudRef = useRef<HTMLPreElement>(null);
  const [tool, setTool] = useState<Tool>('look');
  const channel = useMemo(() => new ChannelController(), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Typing in the channel panel's fields shouldn't switch tools.
      if (isTyping(e)) return;
      const t = TOOLS.find((t) => t.key === e.code);
      if (t) setTool(t.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const onWater = (hud: WaterHud) => {
    if (hudRef.current) hudRef.current.textContent = formatHud(hud);
  };
  if (!('gpu' in navigator)) {
    return <div style={{ padding: 24 }}>This game needs WebGPU, which this browser does not provide.</div>;
  }
  return (
    <>
      <Canvas
        gl={async (props) => {
          const renderer = new WebGPURenderer({ ...(props as object), antialias: false });
          await renderer.init();
          return renderer;
        }}
      >
        <StyleTest onWater={onWater} tool={tool} channel={channel} />
      </Canvas>
      {tool === 'channel' && <ChannelPanel controller={channel} />}
      <div style={{ position: 'fixed', top: 14, left: 16, display: 'flex', gap: 6, font: '14px Georgia, serif' }}>
        {TOOLS.map((t) => (
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
        Earth: G dig · V fill · N channel · Esc look · hold left button to work · right-drag orbits while a tool is on · , . brush size
      </div>
    </>
  );
}
