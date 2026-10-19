import { loadStored, store } from './shared';

// Everything is synthesized with Web Audio, so there are no audio files.
// On iPhone the hardware silent switch also mutes this; that's expected.

const MUTE_KEY = 'date-night-muted-v1';
const VOLUME = 0.8;

let muted = loadStored(MUTE_KEY) === true;
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noise: AudioBuffer | null = null;

export function isMuted(): boolean {
  return muted;
}

export function setMuted(value: boolean): void {
  muted = value;
  store(MUTE_KEY, value);
  if (ctx && master) master.gain.setTargetAtTime(value ? 0 : VOLUME, ctx.currentTime, 0.02);
}

// Call from the "Pick our date" press: browsers only let audio start inside a
// user gesture.
export function unlockAudio(): void {
  if (typeof AudioContext === 'undefined') return;
  if (!ctx) {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : VOLUME;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') void ctx.resume();
}

function audio(): { ctx: AudioContext; out: GainNode } | null {
  return ctx && master ? { ctx, out: master } : null;
}

// One second of white noise, looped by the drumroll.
function noiseBuffer(c: AudioContext): AudioBuffer {
  if (!noise) {
    noise = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  return noise;
}

// A short blip for each reel item that crosses the center line.
export function tick(): void {
  const a = audio();
  if (!a) return;
  const t = a.ctx.currentTime;
  const osc = a.ctx.createOscillator();
  const env = a.ctx.createGain();
  osc.type = 'square';
  osc.frequency.setValueAtTime(1500 + Math.random() * 200, t);
  osc.frequency.exponentialRampToValueAtTime(800, t + 0.03);
  env.gain.setValueAtTime(0.05, t);
  env.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
  osc.connect(env).connect(a.out);
  osc.start(t);
  osc.stop(t + 0.05);
}

export interface Drumroll {
  swell(ms: number): void;
  stop(): void;
}

const SILENT: Drumroll = { swell() {}, stop() {} };

// Filtered noise with a fast tremolo, plus a low rumble for body.
export function drumroll(): Drumroll {
  const a = audio();
  if (!a) return SILENT;
  const c = a.ctx;
  const t = c.currentTime;

  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c);
  src.loop = true;
  const snare = c.createBiquadFilter();
  snare.type = 'bandpass';
  snare.frequency.value = 1800;
  snare.Q.value = 0.7;
  const rumble = c.createBiquadFilter();
  rumble.type = 'lowpass';
  rumble.frequency.value = 160;
  const rumbleGain = c.createGain();
  rumbleGain.gain.value = 2.5;

  // Gain swings 0…1 at 20 Hz: the individual stick hits.
  const tremolo = c.createGain();
  tremolo.gain.value = 0.5;
  const lfo = c.createOscillator();
  lfo.frequency.value = 20;
  const depth = c.createGain();
  depth.gain.value = 0.5;
  lfo.connect(depth).connect(tremolo.gain);

  const env = c.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(0.12, t + 0.3);

  src.connect(snare).connect(tremolo);
  src.connect(rumble).connect(rumbleGain).connect(tremolo);
  tremolo.connect(env).connect(a.out);
  src.start(t);
  lfo.start(t);

  let stopped = false;
  const rampTo = (value: number, seconds: number) => {
    const now = c.currentTime;
    env.gain.cancelScheduledValues(now);
    env.gain.setValueAtTime(env.gain.value, now);
    env.gain.linearRampToValueAtTime(value, now + seconds);
  };
  return {
    swell(ms) {
      if (!stopped) rampTo(0.4, ms / 1000);
    },
    // Cuts to silence, ready for the ta-da.
    stop() {
      if (stopped) return;
      stopped = true;
      rampTo(0, 0.03);
      src.stop(c.currentTime + 0.05);
      lfo.stop(c.currentTime + 0.05);
    },
  };
}

// One brassy note: two detuned saws through a lowpass.
function voice(c: AudioContext, out: AudioNode, freq: number, start: number, length: number, level: number): void {
  const filter = c.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(900, start);
  filter.frequency.exponentialRampToValueAtTime(3200, start + 0.08);
  const env = c.createGain();
  env.gain.setValueAtTime(0.0001, start);
  env.gain.exponentialRampToValueAtTime(level, start + 0.02);
  env.gain.exponentialRampToValueAtTime(0.0001, start + length);
  filter.connect(env).connect(out);
  for (const detune of [-7, 7]) {
    const osc = c.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = freq;
    osc.detune.value = detune;
    osc.connect(filter);
    osc.start(start);
    osc.stop(start + length + 0.05);
  }
}

// A major arpeggio (C E G C) that lands on a held chord.
export function taDa(): void {
  const a = audio();
  if (!a) return;
  const t = a.ctx.currentTime + 0.02;
  const notes = [523.25, 659.25, 783.99, 1046.5];
  notes.forEach((freq, i) => voice(a.ctx, a.out, freq, t + i * 0.08, 0.35, 0.07));
  for (const freq of [261.63, 523.25, 659.25, 783.99]) {
    voice(a.ctx, a.out, freq, t + 0.32, 1.4, 0.05);
  }
}
