import { describe, expect, it } from 'vitest';
import {
  CHANNEL_HALF_WIDTH,
  DAM_TOP,
  downstreamWaterLevel,
  FLUME,
  headAtWheel,
  MILL,
  POND_LEVEL,
  riverBed,
  riverCenter,
  SPILLWAY_CREST,
  terrainHeight,
  upstreamWaterLevel,
  WHEEL,
} from '../src/scene/site';

describe('style-test site layout', () => {
  it('river water stays inside its banks downstream of the dam', () => {
    for (let x = 1; x <= 130; x += 1) {
      const level = downstreamWaterLevel(x);
      const c = riverCenter(x);
      // Water is above the bed in the channel...
      expect(level).toBeGreaterThan(terrainHeight(x, c));
      // ...and below the ground just outside the channel on both sides, except where the
      // wheel pit and tailrace are deliberately dug below river level (they flood).
      const inPit = x > WHEEL.x - 3 && x < WHEEL.x + 3;
      if (!inPit) expect(terrainHeight(x, c + CHANNEL_HALF_WIDTH * 1.5)).toBeGreaterThan(level);
      expect(terrainHeight(x, c - CHANNEL_HALF_WIDTH * 1.5)).toBeGreaterThan(level);
    }
  });

  it('the dam holds the pond: pond above the spillway crest, below the dam top', () => {
    expect(POND_LEVEL).toBeGreaterThan(SPILLWAY_CREST);
    expect(POND_LEVEL).toBeLessThan(DAM_TOP);
    // The pond is contained by ground higher than the dam top at its sides near the dam.
    expect(terrainHeight(-2, riverCenter(-2) + 40)).toBeGreaterThan(DAM_TOP);
    expect(terrainHeight(-2, riverCenter(-2) - 40)).toBeGreaterThan(DAM_TOP);
  });

  it('upstream river rises out of the pond continuously', () => {
    let prev = upstreamWaterLevel(0);
    for (let x = -1; x >= -130; x--) {
      const level = upstreamWaterLevel(x);
      expect(level).toBeGreaterThanOrEqual(prev);
      expect(level - prev).toBeLessThan(0.05);
      prev = level;
    }
    expect(riverBed(-130) + 1).toBeCloseTo(upstreamWaterLevel(-130), 5);
  });

  it('the mill stands on dry ground above the river', () => {
    for (let x = MILL.x0; x <= MILL.x1; x += 2) {
      for (let z = MILL.z0; z <= MILL.z1; z += 2) {
        expect(terrainHeight(x, z)).toBeGreaterThan(downstreamWaterLevel(x) + 0.5);
      }
    }
  });

  it('the wheel pit floods to tailrace level, so the wheel turns in water at the bottom', () => {
    const tail = downstreamWaterLevel(WHEEL.x);
    expect(terrainHeight(WHEEL.x, WHEEL.z)).toBeLessThan(tail);
    expect(WHEEL.y - WHEEL.radius).toBeLessThan(tail);
  });

  it('the wheel sits in a pit below the flume and above the pit floor, with real head', () => {
    expect(terrainHeight(WHEEL.x, WHEEL.z)).toBeLessThan(WHEEL.y - WHEEL.radius);
    expect(FLUME.water).toBeLessThan(POND_LEVEL);
    expect(FLUME.bottom).toBeGreaterThan(WHEEL.y);
    // The flume ends before the wheel's rim instead of running through it.
    expect(FLUME.x1).toBeLessThan(WHEEL.x - WHEEL.radius);
    expect(headAtWheel()).toBeGreaterThan(2);
    expect(headAtWheel()).toBeLessThan(4);
  });
});
