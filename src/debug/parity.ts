import { Fn, instanceIndex, instancedArray, vec4 } from 'three/tsl';
import type { WebGPURenderer } from 'three/webgpu';
import { createWaveNodes, type WaveNodes } from '../water/oceanNodes';
import { GerstnerOcean } from '../water/waves';

export interface ParityResult {
  count: number;
  time: number;
  maxError: number;
  meanError: number;
  worst: { x: number; z: number; cpu: number[]; gpu: number[] };
}

/**
 * Evaluate the GPU wave displacement in a compute shader at random points and compare it
 * with the CPU model. Float32 vs float64 means small differences are expected.
 *
 * Uses its own ocean and uniforms (same code path as rendering): the render loop keeps
 * resetting the live ones to the current time while this awaits the GPU.
 */
export async function checkWaveParity(
  renderer: WebGPURenderer,
  live: GerstnerOcean,
  { count = 4096, extent = 1500, time = 1234.567 } = {},
): Promise<ParityResult> {
  const inputs = new Float32Array(count * 2);
  for (let i = 0; i < count * 2; i++) inputs[i] = (Math.random() - 0.5) * 2 * extent;

  const ocean = new GerstnerOcean(live.specs);
  const waves = createWaveNodes(ocean);
  ocean.setTime(time);
  waves.sync();

  const inBuf = instancedArray(inputs, 'vec2');
  const outBuf = instancedArray(count, 'vec4');
  const kernel = Fn(() => {
    const p = inBuf.element(instanceIndex);
    outBuf.element(instanceIndex).assign(vec4(waves.displacement(p), 1));
  })().compute(count);

  await renderer.computeAsync(kernel);
  const gpu = new Float32Array(await renderer.getArrayBufferAsync(outBuf.value));

  const cpu = [0, 0, 0];
  let maxError = 0;
  let sum = 0;
  let worst: ParityResult['worst'] = { x: 0, z: 0, cpu: [], gpu: [] };
  for (let i = 0; i < count; i++) {
    const x = inputs[i * 2];
    const z = inputs[i * 2 + 1];
    ocean.displace(x, z, cpu);
    const g = [gpu[i * 4], gpu[i * 4 + 1], gpu[i * 4 + 2]];
    // Compare displacement, not absolute position, so large coordinates don't hide errors.
    const err = Math.max(Math.abs(cpu[0] - x - g[0]), Math.abs(cpu[1] - g[1]), Math.abs(cpu[2] - z - g[2]));
    sum += err;
    if (err > maxError || !Number.isFinite(err)) {
      maxError = Number.isFinite(err) ? err : Infinity;
      worst = { x, z, cpu: [cpu[0] - x, cpu[1], cpu[2] - z], gpu: g };
    }
  }

  return { count, time, maxError, meanError: sum / count, worst };
}

/** Read each wave's uniforms back through a compute kernel, to diagnose parity failures. */
export async function probeWaveUniforms(renderer: WebGPURenderer, waves: WaveNodes): Promise<number[][]> {
  const n = waves.a.length;
  const outBuf = instancedArray(n * 2, 'vec4');
  const kernel = Fn(() => {
    for (let i = 0; i < n; i++) {
      outBuf.element(i * 2).assign(vec4(waves.a[i].x, waves.a[i].y, waves.a[i].z, waves.a[i].w));
      outBuf.element(i * 2 + 1).assign(vec4(waves.b[i].x, waves.b[i].y, 0, 0));
    }
  })().compute(1);
  await renderer.computeAsync(kernel);
  const data = new Float32Array(await renderer.getArrayBufferAsync(outBuf.value));
  const rows: number[][] = [];
  for (let i = 0; i < n * 2; i++) rows.push(Array.from(data.slice(i * 4, i * 4 + 4)));
  return rows;
}
