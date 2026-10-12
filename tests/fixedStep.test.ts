import { describe, expect, it } from 'vitest';
import { FixedStep } from '../src/sim/fixedStep';

describe('FixedStep', () => {
  it('produces the same number of steps regardless of frame rate', () => {
    for (const hz of [30, 60, 120, 144, 165]) {
      const fs = new FixedStep(1 / 60);
      let steps = 0;
      for (let i = 0; i < hz * 10; i++) fs.advance(1 / hz, () => steps++);
      // Float accumulation may leave the last step pending.
      expect(steps).toBeGreaterThanOrEqual(599);
      expect(steps).toBeLessThanOrEqual(600);
    }
  });

  it('caps catch-up after a stall and returns alpha in [0, 1)', () => {
    const fs = new FixedStep(1 / 60, 5);
    let steps = 0;
    const alpha = fs.advance(10, () => steps++);
    expect(steps).toBe(5);
    expect(alpha).toBeGreaterThanOrEqual(0);
    expect(alpha).toBeLessThan(1);
    steps = 0;
    fs.advance(1 / 60, () => steps++);
    expect(steps).toBeLessThanOrEqual(2);
  });

  it('ignores bad elapsed values', () => {
    const fs = new FixedStep();
    let steps = 0;
    fs.advance(NaN, () => steps++);
    fs.advance(-1, () => steps++);
    expect(steps).toBe(0);
  });
});
