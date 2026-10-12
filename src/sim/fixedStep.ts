/**
 * Fixed-timestep accumulator. The simulation always advances in exact `dt` steps so that
 * behavior doesn't depend on the display refresh rate.
 */
export class FixedStep {
  private accumulator = 0;
  /** Total simulated time, advanced only in whole steps. */
  time = 0;

  constructor(
    readonly dt = 1 / 60,
    /** Caps catch-up work after a stall (tab switch, GC) so we don't spiral. */
    readonly maxSteps = 5,
  ) {}

  /**
   * Feed elapsed real time; calls `step` zero or more times.
   * Returns the interpolation factor in [0, 1) between the previous and current step.
   */
  advance(elapsed: number, step: (dt: number, time: number) => void): number {
    if (!(elapsed > 0)) elapsed = 0;
    this.accumulator += elapsed;
    let steps = 0;
    while (this.accumulator >= this.dt && steps < this.maxSteps) {
      this.time += this.dt;
      step(this.dt, this.time);
      this.accumulator -= this.dt;
      steps++;
    }
    // Drop time we couldn't catch up on rather than carrying it forever.
    if (this.accumulator >= this.dt) this.accumulator = this.accumulator % this.dt;
    return this.accumulator / this.dt;
  }
}
