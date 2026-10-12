import { Canvas } from '@react-three/fiber';
import { useEffect, useRef, useState } from 'react';
import { ACESFilmicToneMapping } from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { Game, type HudState } from './game/Game';
import { initPhysics } from './game/sim';

type Status = { kind: 'loading' } | { kind: 'ready' } | { kind: 'error'; message: string };

export function App() {
  const [status, setStatus] = useState<Status>({ kind: 'loading' });
  const hudRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!('gpu' in navigator)) {
      setStatus({ kind: 'error', message: 'This game needs WebGPU, which this browser does not provide.' });
      return;
    }
    initPhysics().then(
      () => setStatus({ kind: 'ready' }),
      (e) => setStatus({ kind: 'error', message: `Physics failed to load: ${e}` }),
    );
  }, []);

  const onHud = (s: HudState) => {
    if (hudRef.current) {
      hudRef.current.textContent = `${(s.speed * 1.944).toFixed(1)} kn · ${s.fps.toFixed(0)} fps`;
    }
  };

  if (status.kind === 'error') {
    return <div style={{ padding: 24 }}>{status.message}</div>;
  }
  if (status.kind === 'loading') {
    return <div style={{ padding: 24 }}>Loading…</div>;
  }

  return (
    <>
      <Canvas
        camera={{ fov: 60, near: 0.1, far: 6000, position: [0, 5, 10] }}
        gl={async (props) => {
          const renderer = new WebGPURenderer({ ...(props as object), antialias: true });
          await renderer.init();
          if (!(renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend) {
            setStatus({ kind: 'error', message: 'WebGPU is unavailable (no adapter); the WebGL fallback is not supported.' });
          }
          renderer.toneMapping = ACESFilmicToneMapping;
          renderer.toneMappingExposure = 0.9;
          return renderer;
        }}
      >
        <Game onHud={onHud} />
      </Canvas>
      <div style={{ position: 'fixed', left: 16, bottom: 16, fontSize: 13, opacity: 0.85, pointerEvents: 'none', textShadow: '0 1px 2px #0008' }}>
        <div ref={hudRef} />
        <div>W/S throttle · A/D steer · drag to orbit · wheel to zoom</div>
      </div>
    </>
  );
}
