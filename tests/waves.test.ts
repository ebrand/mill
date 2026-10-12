import { describe, expect, it } from 'vitest';
import { DEFAULT_SEA, GerstnerOcean, newSample } from '../src/water/waves';

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

describe('GerstnerOcean', () => {
  const ocean = new GerstnerOcean(DEFAULT_SEA);

  it('cannot form loops: sum(Q*k*A) <= 1', () => {
    const s = ocean.waves.reduce((acc, w) => acc + w.q * w.k * w.amplitude, 0);
    expect(s).toBeLessThanOrEqual(1);
    expect(s).toBeGreaterThan(0.3); // and isn't trivially flat
  });

  it('height at a world point matches the displaced surface (inverse solve)', () => {
    const r = rng(1);
    const P = [0, 0, 0];
    const sample = newSample();
    let maxErr = 0;
    for (let i = 0; i < 2000; i++) {
      ocean.setTime(r() * 1000);
      const px = (r() - 0.5) * 2000;
      const pz = (r() - 0.5) * 2000;
      ocean.displace(px, pz, P);
      ocean.sample(P[0], P[2], sample);
      maxErr = Math.max(maxErr, Math.abs(sample.height - P[1]));
    }
    expect(maxErr).toBeLessThan(1e-3);
  });

  it('ignoring horizontal displacement would be badly wrong (guards the test above)', () => {
    const r = rng(2);
    const P = [0, 0, 0];
    let maxErr = 0;
    for (let i = 0; i < 500; i++) {
      ocean.setTime(r() * 1000);
      const px = (r() - 0.5) * 500;
      const pz = (r() - 0.5) * 500;
      ocean.displace(px, pz, P);
      const naive = [0, 0, 0];
      ocean.displace(P[0], P[2], naive);
      maxErr = Math.max(maxErr, Math.abs(naive[1] - P[1]));
    }
    expect(maxErr).toBeGreaterThan(0.1);
  });

  it('surface velocity matches the time derivative of a water particle', () => {
    const r = rng(3);
    const a = [0, 0, 0];
    const b = [0, 0, 0];
    const s = newSample();
    const h = 1e-4;
    for (let i = 0; i < 200; i++) {
      const t = r() * 500;
      const px = (r() - 0.5) * 400;
      const pz = (r() - 0.5) * 400;
      ocean.setTime(t - h);
      ocean.displace(px, pz, a);
      ocean.setTime(t + h);
      ocean.displace(px, pz, b);
      ocean.setTime(t);
      const P = [0, 0, 0];
      ocean.displace(px, pz, P);
      ocean.sample(P[0], P[2], s);
      expect(s.vx).toBeCloseTo((b[0] - a[0]) / (2 * h), 2);
      expect(s.vy).toBeCloseTo((b[1] - a[1]) / (2 * h), 2);
      expect(s.vz).toBeCloseTo((b[2] - a[2]) / (2 * h), 2);
    }
  });

  it('keeps phases wrapped for long sessions', () => {
    ocean.setTime(1e7);
    for (const p of ocean.phase) {
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThan(Math.PI * 2);
    }
  });
});
