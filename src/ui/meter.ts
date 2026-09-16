export interface FrameReading {
  rendered: number;
  drawCalls: number;
  triangles: number;
  span: number;
  planting: boolean;
}

const WINDOW_MILLIS = 500;

export class FrameMeter {
  private readonly root = document.createElement('div');
  private since = 0;
  private ticks = 0;
  private renderedAtStart = 0;
  private longestGap = 0;
  private previous = 0;

  constructor(host: HTMLElement) {
    this.root.className = 'frame-meter';
    this.root.setAttribute('aria-hidden', 'true');
    host.append(this.root);
  }

  sample(now: number, reading: FrameReading): void {
    if (this.since === 0) {
      this.since = now;
      this.previous = now;
      this.renderedAtStart = reading.rendered;
      return;
    }
    this.ticks++;
    this.longestGap = Math.max(this.longestGap, now - this.previous);
    this.previous = now;
    const elapsed = now - this.since;
    if (elapsed < WINDOW_MILLIS) return;
    const perSecond = 1000 / elapsed;
    const drawn = Math.round((reading.rendered - this.renderedAtStart) * perSecond);
    this.root.textContent = [
      `${drawn} drawn/s`,
      `${Math.round(this.ticks * perSecond)} frames/s`,
      `${this.longestGap.toFixed(1)} ms worst`,
      `${reading.drawCalls} calls`,
      `${Math.round(reading.triangles / 1000)}k tris`,
      `span ${reading.span.toFixed(0)}`,
      reading.planting ? 'planting' : 'planted',
    ].join('\n');
    this.since = now;
    this.ticks = 0;
    this.longestGap = 0;
    this.renderedAtStart = reading.rendered;
  }

  dispose(): void {
    this.root.remove();
  }
}
