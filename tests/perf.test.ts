// Solver throughput on the real site. Skipped unless PERF=1:  PERF=1 npx vitest run tests/perf.test.ts
import { describe, it } from 'vitest';
import { buildRiverSim } from '../src/water/riverSim';

describe.skipIf(!process.env.PERF)('water solver performance', () => {
  for (const dx of [1, 0.5]) {
    it(`site at ${dx} m cells`, () => {
      const sim = buildRiverSim({ dx });
      sim.advance(30); // warm up the JIT and let the start settle a little
      const steps = 400;
      const dt = sim.stableDt();
      const t0 = performance.now();
      for (let s = 0; s < steps; s++) sim.step(dt);
      const ms = (performance.now() - t0) / steps;
      const cells = sim.nx * sim.nz;
      const simSecondsPerWallSecond = (dt * 1000) / ms;
      console.log(
        `dx ${dx} m: ${sim.nx}x${sim.nz} = ${cells} cells, ${ms.toFixed(2)} ms/step, ` +
          `${((ms * 1e6) / cells).toFixed(1)} ns/cell, stable dt ${dt.toFixed(3)} s, ` +
          `max speed-up ${simSecondsPerWallSecond.toFixed(1)}x real time (whole CPU core)`,
      );
    });
  }
});
