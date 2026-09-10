export type SoundCue = 'build' | 'road' | 'remove' | 'error' | 'arrival' | 'delivery' | 'upgrade' | 'goal';

const SOUND_KEY = 'oikos.sound.v1';
const NOTES: Record<SoundCue, number[]> = {
  build: [330, 440],
  road: [220],
  remove: [220, 165],
  error: [147],
  arrival: [392, 494],
  delivery: [440, 554, 659],
  upgrade: [330, 440, 554],
  goal: [330, 440, 554, 659],
};

export function createSound() {
  let enabled = true;
  let context: AudioContext | null = null;
  let lastCue = -Infinity;
  let lastPriority = -Infinity;
  try { enabled = localStorage.getItem(SOUND_KEY) !== 'off'; } catch {}

  function unlock(): void {
    if (!enabled) return;
    try {
      context ??= new AudioContext();
      if (context.state === 'suspended') void context.resume().catch(() => {});
    } catch {}
  }

  function play(cue: SoundCue): void {
    if (!enabled || !context || context.state !== 'running') return;
    const now = context.currentTime;
    const priority = cue === 'arrival' || cue === 'delivery' || cue === 'upgrade' || cue === 'goal';
    if (now - lastCue < .08 || (!priority && now - lastPriority < .6)) return;
    if (priority) lastPriority = now;
    lastCue = now;
    const notes = NOTES[cue];
    notes.forEach((frequency, index) => {
      const start = now + index * .09;
      const oscillator = context!.createOscillator();
      const gain = context!.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(frequency, start);
      oscillator.frequency.exponentialRampToValueAtTime(frequency * .98, start + .18);
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(.035, start + .008);
      gain.gain.exponentialRampToValueAtTime(.0001, start + .22);
      oscillator.connect(gain);
      gain.connect(context!.destination);
      oscillator.start(start);
      oscillator.stop(start + .25);
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
    });
  }

  function setEnabled(value: boolean): void {
    enabled = value;
    try { localStorage.setItem(SOUND_KEY, value ? 'on' : 'off'); } catch {}
    if (value) unlock();
    else if (context?.state === 'running') void context.suspend().catch(() => {});
  }

  return { get enabled() { return enabled; }, unlock, play, setEnabled };
}
