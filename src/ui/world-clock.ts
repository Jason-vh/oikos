const LEAD = .75;
const SNAP_GAP = 1;

export class WorldClock {
  private time: number;
  private authoritative: number;

  constructor(worldTime: number) {
    this.time = worldTime;
    this.authoritative = worldTime;
  }

  get now(): number {
    return this.time;
  }

  observe(worldTime: number): void {
    this.authoritative = worldTime;
    if (Math.abs(worldTime - this.time) > SNAP_GAP) this.time = worldTime;
  }

  advance(delta: number): void {
    this.time = Math.min(this.time + delta, this.authoritative + LEAD);
  }
}
