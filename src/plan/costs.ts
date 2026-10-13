// What works cost, in labor, materials and dollars. Period figures for New England around
// 1820; every number here is an estimate to check against sources before scenarios rely
// on it.

export const YD3_PER_M3 = 1.30795;

export const RATES = {
  /** Daily wages, dollars (estimate: common labor $0.75-$1.00). */
  laborerWage: 0.85,
  masonWage: 1.5,
  millwrightWage: 1.75,
  /** Cubic yards one laborer moves in a day (estimate). */
  digEarthYd3PerDay: 8,
  /** Ledge: hand-drilled and blasted with black powder (estimate). */
  digRockYd3PerDay: 1,
  /** Spreading and tamping fill (estimate). */
  placeFillYd3PerDay: 15,
  /** Dry-laid or mortared wall stone: mason-days per yd3, with a laborer each (estimate). */
  masonDaysPerYd3: 1,
  /** Purchased materials, dollars (estimates). */
  stonePerYd3: 1.5,
  timberPer1000bf: 8,
  ironPerLb: 0.08,
};

export interface Cost {
  /** Days of work by trade. */
  laborerDays: number;
  masonDays: number;
  millwrightDays: number;
  /** Materials. */
  stoneYd3: number;
  timberBf: number;
  ironLb: number;
  /** Earth moved, yd3. */
  cutYd3: number;
  fillYd3: number;
  /** Total in dollars (wages + purchased materials). */
  dollars: number;
}

export function emptyCost(): Cost {
  return { laborerDays: 0, masonDays: 0, millwrightDays: 0, stoneYd3: 0, timberBf: 0, ironLb: 0, cutYd3: 0, fillYd3: 0, dollars: 0 };
}

export function priced(c: Omit<Cost, 'dollars'>): Cost {
  const r = RATES;
  const dollars =
    c.laborerDays * r.laborerWage +
    c.masonDays * r.masonWage +
    c.millwrightDays * r.millwrightWage +
    c.stoneYd3 * r.stonePerYd3 +
    (c.timberBf / 1000) * r.timberPer1000bf +
    c.ironLb * r.ironPerLb;
  return { ...c, dollars };
}

export function addCosts(a: Cost, b: Cost): Cost {
  return {
    laborerDays: a.laborerDays + b.laborerDays,
    masonDays: a.masonDays + b.masonDays,
    millwrightDays: a.millwrightDays + b.millwrightDays,
    stoneYd3: a.stoneYd3 + b.stoneYd3,
    timberBf: a.timberBf + b.timberBf,
    ironLb: a.ironLb + b.ironLb,
    cutYd3: a.cutYd3 + b.cutYd3,
    fillYd3: a.fillYd3 + b.fillYd3,
    dollars: a.dollars + b.dollars,
  };
}

/**
 * Earthworks: digging (rock far slower than soil) and placing fill. Fill comes from the
 * same job's cut first; anything more must be dug from a borrow pit too.
 */
export function earthworkCost(cutM3: number, cutRockM3: number, fillM3: number): Cost {
  const r = RATES;
  const soil = Math.max(0, cutM3 - cutRockM3) * YD3_PER_M3;
  const rock = cutRockM3 * YD3_PER_M3;
  const fill = fillM3 * YD3_PER_M3;
  const borrow = Math.max(0, fill - soil - rock);
  const laborerDays = soil / r.digEarthYd3PerDay + rock / r.digRockYd3PerDay + fill / r.placeFillYd3PerDay + borrow / r.digEarthYd3PerDay;
  return priced({ laborerDays, masonDays: 0, millwrightDays: 0, stoneYd3: 0, timberBf: 0, ironLb: 0, cutYd3: soil + rock, fillYd3: fill });
}

/** A timber head gate with iron fittings (estimate: 800 bf, 60 lb, 6 millwright-days at 2 m). */
export function gateCost(width: number): Cost {
  const scale = width / 2;
  return priced({ laborerDays: 4 * scale, masonDays: 0, millwrightDays: 6 * scale, stoneYd3: 0, timberBf: 800 * scale, ironLb: 60 * scale, cutYd3: 0, fillYd3: 0 });
}

/**
 * A breastshot wheel, scaled by its size (estimate: a 4.8 m x 2.2 m wheel is about 4,000
 * board feet, 600 lb of iron in axle and gudgeons, and 90 millwright-days), plus stone side
 * walls for its pit, 0.6 m thick.
 */
export function wheelCost(diameter: number, width: number, pitLength: number, pitDepth: number): Cost {
  const size = (diameter * width) / (4.8 * 2.2);
  const wallsYd3 = 2 * pitLength * Math.max(0, pitDepth) * 0.6 * YD3_PER_M3;
  const r = RATES;
  return priced({
    laborerDays: 20 * size + wallsYd3 * r.masonDaysPerYd3,
    masonDays: wallsYd3 * r.masonDaysPerYd3,
    millwrightDays: 90 * size,
    stoneYd3: wallsYd3,
    timberBf: 4000 * size,
    ironLb: 600 * size,
    cutYd3: 0,
    fillYd3: 0,
  });
}

export function formatDollars(d: number): string {
  return `$${Math.round(d).toLocaleString()}`;
}

/**
 * A timber-crib spillway: a crib of squared timber faced with plank and ballasted with stone,
 * by face area (crest length x height above the lowest ground). Estimates: 300 bd ft and
 * 0.5 yd3 of stone per m2 of face; 1.5 millwright-days and 3 laborer-days per m of crest.
 */
export function spillwayCost(length: number, height: number): Cost {
  const face = length * Math.max(0.5, height);
  return priced({
    laborerDays: 3 * length + face,
    masonDays: 0,
    millwrightDays: 1.5 * length,
    stoneYd3: 0.5 * face,
    timberBf: 300 * face,
    ironLb: 20 * length,
    cutYd3: 0,
    fillYd3: 0,
  });
}
