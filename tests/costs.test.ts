import { describe, expect, it } from 'vitest';
import { addCosts, earthworkCost, gateCost, RATES, wheelCost, YD3_PER_M3 } from '../src/plan/costs';

describe('costs', () => {
  it('digging earth: labor-days at the earth rate, priced at the laborer wage', () => {
    const c = earthworkCost(80 / YD3_PER_M3, 0, 0); // 80 yd3 of soil
    expect(c.cutYd3).toBeCloseTo(80, 6);
    expect(c.laborerDays).toBeCloseTo(80 / RATES.digEarthYd3PerDay, 6);
    expect(c.dollars).toBeCloseTo(c.laborerDays * RATES.laborerWage, 6);
  });

  it('ledge costs far more than soil for the same volume', () => {
    const soil = earthworkCost(10, 0, 0);
    const rock = earthworkCost(10, 10, 0);
    expect(rock.laborerDays / soil.laborerDays).toBeCloseTo(RATES.digEarthYd3PerDay / RATES.digRockYd3PerDay, 6);
  });

  it('fill uses the job’s own cut first, then must be borrowed', () => {
    const balanced = earthworkCost(100, 0, 100);
    const short = earthworkCost(0, 0, 100);
    // Short of cut: the same fill also has to be dug somewhere.
    expect(short.laborerDays).toBeCloseTo((100 * YD3_PER_M3) / RATES.placeFillYd3PerDay + (100 * YD3_PER_M3) / RATES.digEarthYd3PerDay, 6);
    expect(balanced.laborerDays).toBeCloseTo(short.laborerDays, 6);
    expect(earthworkCost(0, 0, 0).dollars).toBe(0);
  });

  it('wheels and gates scale with size; pit walls need stone and masons', () => {
    const small = wheelCost(4.8, 2.2, 0, 0);
    expect(small.timberBf).toBeCloseTo(4000, 6);
    expect(small.stoneYd3).toBe(0);
    const big = wheelCost(6.4, 2.2, 8, 3);
    expect(big.timberBf).toBeGreaterThan(small.timberBf);
    expect(big.stoneYd3).toBeCloseTo(2 * 8 * 3 * 0.6 * YD3_PER_M3, 6);
    expect(big.masonDays).toBeGreaterThan(0);
    expect(gateCost(4).timberBf).toBeCloseTo(2 * gateCost(2).timberBf, 6);
    const sum = addCosts(small, gateCost(2));
    expect(sum.dollars).toBeCloseTo(small.dollars + gateCost(2).dollars, 9);
  });
});
