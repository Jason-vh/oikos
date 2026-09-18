export interface Dial<T extends object> {
  label: string;
  of: T;
  key: keyof T & string;
  min: number;
  max: number;
  step: number;
}

export class Tuner {
  private readonly root = document.createElement('div');

  constructor(host: HTMLElement, dials: Dial<never>[]) {
    this.root.className = 'tuner';
    this.root.setAttribute('aria-hidden', 'true');
    for (const dial of dials) this.root.append(this.row(dial));
    host.append(this.root);
  }

  private row<T extends object>(dial: Dial<T>): HTMLElement {
    const row = document.createElement('label');
    row.className = 'tuner-dial';
    const name = document.createElement('span');
    name.textContent = dial.label;
    const readout = document.createElement('b');
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = String(dial.min);
    slider.max = String(dial.max);
    slider.step = String(dial.step);
    slider.value = String(dial.of[dial.key]);
    const show = () => { readout.textContent = Number(slider.value).toFixed(2); };
    slider.addEventListener('input', () => {
      (dial.of[dial.key] as unknown as number) = Number(slider.value);
      show();
    });
    show();
    row.append(name, slider, readout);
    return row;
  }

  dispose(): void {
    this.root.remove();
  }
}
