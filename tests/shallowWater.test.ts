import { describe, expect, it } from 'vitest';
import { G, ShallowWater } from '../src/water/shallowWater';

function grid(nx: number, nz: number, dx: number, bedFn: (x: number, z: number) => number) {
  const bed = new Float64Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) bed[j * nx + i] = bedFn((i + 0.5) * dx, (j + 0.5) * dx);
  return new ShallowWater({ nx, nz, dx, x0: 0, z0: 0 }, bed);
}

function hasBadValue(sim: ShallowWater): boolean {
  for (const d of sim.depth) if (!Number.isFinite(d) || d < 0) return true;
  return false;
}

describe('ShallowWater (local inertial)', () => {
  it('conserves mass exactly in a closed basin while water sloshes', () => {
    const sim = grid(60, 40, 1, (x, z) => 0.3 * Math.sin(x * 0.2) * Math.cos(z * 0.3));
    // A mound of water in one corner, dry patches elsewhere.
    for (let j = 0; j < 40; j++) for (let i = 0; i < 60; i++) {
      const c = j * 60 + i;
      const mound = Math.max(0, 1.5 - Math.hypot(i - 15, j - 20) * 0.12);
      sim.depth[c] = Math.max(0, 0.4 + mound - sim.bed[c]);
    }
    const v0 = sim.totalVolume();
    sim.advance(600);
    const v1 = sim.totalVolume();
    expect(hasBadValue(sim)).toBe(false);
    expect(Math.abs(v1 - v0) / v0).toBeLessThan(1e-9);
    expect(sim.volumeIn).toBe(0);
    expect(sim.volumeOut).toBe(0);
  });

  it('keeps a lake at rest over uneven ground (well-balanced)', () => {
    const sim = grid(50, 50, 1, (x, z) => 0.8 * Math.sin(x * 0.37) + 0.5 * Math.cos(z * 0.21) + (x > 30 ? 1.2 : 0));
    const level = 1.0;
    for (let c = 0; c < sim.depth.length; c++) sim.depth[c] = Math.max(0, level - sim.bed[c]);
    sim.advance(300);
    let maxQ = 0;
    for (const q of sim.qx) maxQ = Math.max(maxQ, Math.abs(q));
    for (const q of sim.qz) maxQ = Math.max(maxQ, Math.abs(q));
    expect(maxQ).toBeLessThan(1e-9);
    for (let c = 0; c < sim.depth.length; c++) {
      if (sim.depth[c] > 0) expect(sim.bed[c] + sim.depth[c]).toBeCloseTo(level, 9);
    }
  });

  it('reaches Manning normal depth in a uniform sloped channel', () => {
    const slope = 0.008;
    const width = 12;
    const nx = 200;
    const nz = width;
    const sim = grid(nx, nz, 1, (x) => -slope * x);
    sim.manning = 0.035;
    const Q = 12;
    sim.inflow = { rows: Array.from({ length: nz }, (_, j) => j), discharge: Q };
    sim.outflow = { slope };
    sim.advance(1800);
    // Normal depth for a wide channel: q = (1/n) h^(5/3) sqrt(S).
    const q = Q / width;
    const hNormal = Math.pow((q * sim.manning) / Math.sqrt(slope), 3 / 5);
    // Sample mid-reach, away from both boundaries.
    let sum = 0;
    for (let j = 0; j < nz; j++) sum += sim.depth[j * nx + 100];
    const h = sum / nz;
    console.log(`normal depth: simulated ${h.toFixed(4)} m, Manning ${hNormal.toFixed(4)} m; outflow ${sim.lastOutflow.toFixed(3)} m3/s`);
    expect(Math.abs(h - hNormal) / hNormal).toBeLessThan(0.03);
    expect(Math.abs(sim.lastOutflow - Q) / Q).toBeLessThan(0.01);
    // Subcritical, as the solver assumes.
    const froude = q / h / Math.sqrt(G * h);
    expect(froude).toBeLessThan(1);
  });

  function damChannel(useWeir: boolean) {
    const nx = 120;
    const nz = 10;
    const crest = 2.0;
    let sim: ShallowWater;
    if (useWeir) {
      // A dam is a thin wall: a weir on the edge between pond (cell 59) and tailwater
      // (cell 60), with no raised bed cell that would read as drowned tailwater.
      sim = grid(nx, nz, 1, (x) => -0.005 * x);
      for (let j = 0; j < nz; j++) sim.addWeir({ axis: 'x', edge: j * (nx + 1) + 60, crest, coefficient: 1.7 });
    } else {
      // The same crest as raised terrain, one cell wide.
      sim = grid(nx, nz, 1, (x) => (Math.floor(x) === 60 ? crest : -0.005 * x));
    }
    const Q = 4;
    sim.inflow = { rows: Array.from({ length: nz }, (_, j) => j), discharge: Q };
    sim.outflow = { slope: 0.005 };
    sim.advance(4 * 3600);
    const pond = sim.bed[30] + sim.depth[30];
    const head = pond - crest;
    return { sim, Q, nz, head, C: Q / (nz * Math.pow(head, 1.5)) };
  }

  it('fills a pond behind a weir until it spills, then passes the inflow with the weir law', () => {
    const { sim, Q, head, C } = damChannel(true);
    console.log(`weir: head over crest ${head.toFixed(3)} m, effective C ${C.toFixed(3)}, outflow ${sim.lastOutflow.toFixed(3)}`);
    expect(head).toBeGreaterThan(0);
    expect(Math.abs(C - 1.7) / 1.7).toBeLessThan(0.03);
    expect(Math.abs(sim.lastOutflow - Q) / Q).toBeLessThan(0.02);
    // Mass balance: stored = in - out.
    const stored = sim.totalVolume();
    expect(Math.abs(stored - (sim.volumeIn - sim.volumeOut)) / stored).toBeLessThan(1e-9);
    expect(hasBadValue(sim)).toBe(false);
  });

  it('plain terrain steps stay bounded by critical flow (known overestimate vs a real weir)', () => {
    const { sim, Q, head, C } = damChannel(false);
    console.log(`plain step: head over crest ${head.toFixed(3)} m, effective C ${C.toFixed(3)} (weir ~1.7, critical bound ${Math.sqrt(G).toFixed(2)})`);
    expect(C).toBeGreaterThan(1.6);
    expect(C).toBeLessThanOrEqual(Math.sqrt(G) * 1.01);
    expect(Math.abs(sim.lastOutflow - Q) / Q).toBeLessThan(0.02);
  });

  it('stays stable however the caller chunks time (no short leftover steps)', () => {
    // Deep, low-friction pond behind a weir: the case that oscillated when every call
    // ended with a short leftover step.
    const results: string[] = [];
    for (const chunk of [100, 16 / 60, 1 / 60, 0.37, 0.05]) {
      const nx = 80;
      const nz = 20;
      const sim = grid(nx, nz, 1, (x) => -0.008 * x - (x < 40 ? 2.5 : 0));
      for (let j = 0; j < nz; j++) sim.addWeir({ axis: 'x', edge: j * (nx + 1) + 40, crest: 0.6, coefficient: 1.7 });
      sim.inflow = { rows: Array.from({ length: nz }, (_, j) => j), discharge: 8 };
      sim.outflow = { slope: 0.008 };
      for (let c = 0; c < sim.depth.length; c++) sim.depth[c] = Math.max(0, 1.0 - sim.bed[c]);
      let lo = Infinity;
      let hi = -Infinity;
      while (sim.time < 900) {
        sim.advance(chunk);
        if (sim.time > 600) {
          const eta = sim.bed[10 * nx + 20] + sim.depth[10 * nx + 20];
          lo = Math.min(lo, eta);
          hi = Math.max(hi, eta);
        }
      }
      results.push(`${chunk.toFixed(3)}s: ${lo.toFixed(3)}..${hi.toFixed(3)}`);
      expect(hi - lo).toBeLessThan(0.05);
      expect(hasBadValue(sim)).toBe(false);
    }
    console.log('pond level range by chunk size:', results.join(' | '));
  });
});
