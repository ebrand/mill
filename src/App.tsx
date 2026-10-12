import { Canvas } from '@react-three/fiber';
import { WebGPURenderer } from 'three/webgpu';

export function App() {
  if (!('gpu' in navigator)) {
    return <div style={{ padding: 24 }}>This game needs WebGPU, which this browser does not provide.</div>;
  }
  return (
    <Canvas
      gl={async (props) => {
        const renderer = new WebGPURenderer({ ...(props as object), antialias: true });
        await renderer.init();
        return renderer;
      }}
    />
  );
}
