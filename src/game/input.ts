import type { BoatInput } from '../physics/boat';

/** Keyboard state sampled once per fixed step. */
export class KeyboardInput {
  private readonly down = new Set<string>();
  private readonly onDown = (e: KeyboardEvent) => this.down.add(e.code);
  private readonly onUp = (e: KeyboardEvent) => this.down.delete(e.code);
  private readonly onBlur = () => this.down.clear();
  private throttle = 0;
  private steer = 0;

  attach(target: Window = window): () => void {
    target.addEventListener('keydown', this.onDown);
    target.addEventListener('keyup', this.onUp);
    target.addEventListener('blur', this.onBlur);
    return () => {
      target.removeEventListener('keydown', this.onDown);
      target.removeEventListener('keyup', this.onUp);
      target.removeEventListener('blur', this.onBlur);
    };
  }

  private axis(pos: string[], neg: string[]): number {
    return (pos.some((k) => this.down.has(k)) ? 1 : 0) - (neg.some((k) => this.down.has(k)) ? 1 : 0);
  }

  /** Smooths toward the pressed keys so the engine and rudder don't snap. */
  update(dt: number, out: BoatInput): void {
    const targetThrottle = this.axis(['KeyW', 'ArrowUp'], ['KeyS', 'ArrowDown']);
    const targetSteer = this.axis(['KeyD', 'ArrowRight'], ['KeyA', 'ArrowLeft']);
    this.throttle += (targetThrottle - this.throttle) * Math.min(1, dt * 2.5);
    this.steer += (targetSteer - this.steer) * Math.min(1, dt * 5);
    out.throttle = Math.abs(this.throttle) < 1e-3 ? 0 : this.throttle;
    out.steer = Math.abs(this.steer) < 1e-3 ? 0 : this.steer;
  }
}
