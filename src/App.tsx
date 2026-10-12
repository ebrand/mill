import { Canvas } from '@react-three/fiber';
import { useRef } from 'react';
import { WebGPURenderer } from 'three/webgpu';
import { StyleTest, type WaterHud } from './scene/StyleTest';

function formatHud({ stats, speed, discharge, error }: WaterHud): string {
  if (error) return `Water sim error: ${error}`;
  if (!stats) return 'Water: starting…';
  const t = stats.time;
  const clock = `${Math.floor(t / 3600)}h ${String(Math.floor((t % 3600) / 60)).padStart(2, '0')}m`;
  return [
    `River ${clock} · ${speed === 0 ? 'paused' : `${speed}×`}`,
    `inflow ${discharge.toFixed(0)} m³/s · over dam ${stats.spill.toFixed(1)} · leaving ${stats.outflow.toFixed(1)}`,
    `pond ${stats.pondLevel.toFixed(2)} m · stored ${(stats.volume / 1000).toFixed(1)}k m³ · ${stats.stepMs.toFixed(1)} ms (${stats.steps} steps)`,
  ].join('\n');
}

export function App() {
  const hudRef = useRef<HTMLPreElement>(null);
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
        <StyleTest onWater={onWater} />
      </Canvas>
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
      </div>
    </>
  );
}
