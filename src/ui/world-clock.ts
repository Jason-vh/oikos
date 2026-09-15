const CORRECTION_SHARE = .1;
const SNAP_GAP = 1;

export class WorldClock {
  private elapsed = 0;
  private offset: number;

  constructor(worldTime: number) {
    this.offset = worldTime;
  }

  get now(): number {
    return this.elapsed + this.offset;
  }

  advance(delta: number): void {
    this.elapsed += delta;
  }

  observe(worldTime: number): void {
    const implied = worldTime - this.elapsed;
    if (Math.abs(implied - this.offset) > SNAP_GAP) {
      this.offset = implied;
      return;
    }
    this.offset += (implied - this.offset) * CORRECTION_SHARE;
  }
}
