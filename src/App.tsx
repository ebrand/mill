import { Canvas } from '@react-three/fiber';
import { WebGPURenderer } from 'three/webgpu';
import { StyleTest } from './scene/StyleTest';

export function App() {
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
        <StyleTest />
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
        Style test · drag to orbit · scroll to zoom · C cutaway · S shadow style · E outlines · H hatching
      </div>
    </>
  );
}
