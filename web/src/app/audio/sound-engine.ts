/**
 * Synthesized sound effects and background music, Web Audio only — no audio files.
 * The AudioContext is created lazily on the first call after a user gesture (browsers
 * refuse to start audio before one), and music pauses automatically while the tab is hidden.
 */

// D Hijaz: D Eb F# G A Bb C D — semitone, augmented 2nd, semitone, whole, semitone, whole, whole.
const HIJAZ_ON_D = [293.66, 311.13, 369.99, 392.0, 440.0, 466.16, 523.25, 587.33];

// A maqsum-ish pattern over 8 eighth-note slots: Doum . Tek . . Tek Doum .
type DrumHit = 'doum' | 'tek' | null;
const MAQSUM_PATTERN: DrumHit[] = ['doum', null, 'tek', null, null, 'tek', 'doum', null];

const BPM = 92;
const SIXTEENTH_SECONDS = 60 / BPM / 4;
const SCHEDULE_AHEAD_SECONDS = 0.12;
const SCHEDULER_INTERVAL_MS = 25;

export class SoundEngine {
  private context: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private musicGain: GainNode | null = null;

  private musicPlaying = false;
  private nextNoteTime = 0;
  private sixteenthIndex = 0;
  private schedulerHandle: ReturnType<typeof setInterval> | null = null;
  private droneNode: OscillatorNode | null = null;
  private visibilityHandler = () => this.onVisibilityChange();

  /** Must be called from inside a user gesture handler before any sound can play. */
  unlock(): void {
    this.ensureContext();
    void this.context?.resume();
  }

  private ensureContext(): AudioContext {
    if (!this.context) {
      this.context = new AudioContext();
      this.masterGain = this.context.createGain();
      this.masterGain.gain.value = 0.9;
      this.masterGain.connect(this.context.destination);

      this.musicGain = this.context.createGain();
      this.musicGain.gain.value = 0.22;
      this.musicGain.connect(this.masterGain);

      if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', this.visibilityHandler);
      }
    }
    return this.context;
  }

  // ---- Effects -----------------------------------------------------------

  playClick(): void {
    const ctx = this.ensureContext();
    this.tone(ctx, 720, 0.04, 'sine', 0.18, ctx.currentTime);
  }

  playMoveTap(): void {
    const ctx = this.ensureContext();
    this.woodTap(ctx, ctx.currentTime, 0.5);
  }

  playCapture(): void {
    const ctx = this.ensureContext();
    this.woodTap(ctx, ctx.currentTime, 1);
  }

  playPromotion(): void {
    const ctx = this.ensureContext();
    const start = ctx.currentTime;
    [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
      this.tone(ctx, freq, 0.16, 'triangle', 0.16, start + i * 0.09);
    });
  }

  playWin(): void {
    const ctx = this.ensureContext();
    const start = ctx.currentTime;
    [392, 523.25, 659.25].forEach((freq, i) => {
      this.tone(ctx, freq, 0.22, 'triangle', 0.2, start + i * 0.12);
    });
  }

  playLoss(): void {
    const ctx = this.ensureContext();
    const start = ctx.currentTime;
    [392, 329.63, 261.63].forEach((freq, i) => {
      this.tone(ctx, freq, 0.26, 'sawtooth', 0.12, start + i * 0.14);
    });
  }

  private tone(
    ctx: AudioContext,
    frequency: number,
    duration: number,
    type: OscillatorType,
    gainValue: number,
    startTime: number,
  ): void {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = frequency;
    gain.gain.setValueAtTime(0, startTime);
    gain.gain.linearRampToValueAtTime(gainValue, startTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
    osc.connect(gain);
    gain.connect(this.masterGain!);
    osc.start(startTime);
    osc.stop(startTime + duration + 0.02);
  }

  private woodTap(ctx: AudioContext, startTime: number, intensity: number): void {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(260 * intensity + 120, startTime);
    osc.frequency.exponentialRampToValueAtTime(90, startTime + 0.08);
    gain.gain.setValueAtTime(0.22 * intensity + 0.08, startTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.14);
    osc.connect(gain);
    gain.connect(this.masterGain!);
    osc.start(startTime);
    osc.stop(startTime + 0.16);
  }

  // ---- Background music ---------------------------------------------------

  startMusic(): void {
    if (this.musicPlaying) return;
    const ctx = this.ensureContext();
    this.musicPlaying = true;
    this.sixteenthIndex = 0;
    this.nextNoteTime = ctx.currentTime + 0.1;
    this.startDrone(ctx);
    this.schedulerHandle = setInterval(() => this.scheduler(), SCHEDULER_INTERVAL_MS);
  }

  stopMusic(): void {
    this.musicPlaying = false;
    if (this.schedulerHandle !== null) {
      clearInterval(this.schedulerHandle);
      this.schedulerHandle = null;
    }
    this.stopDrone();
  }

  private onVisibilityChange(): void {
    if (typeof document === 'undefined') return;
    if (document.hidden) {
      void this.context?.suspend();
    } else if (this.musicPlaying) {
      void this.context?.resume();
    }
  }

  private startDrone(ctx: AudioContext): void {
    this.droneNode = ctx.createOscillator();
    const gain = ctx.createGain();
    this.droneNode.type = 'sine';
    this.droneNode.frequency.value = HIJAZ_ON_D[0] / 2; // low D
    gain.gain.value = 0.5;
    this.droneNode.connect(gain);
    gain.connect(this.musicGain!);
    this.droneNode.start();
  }

  private stopDrone(): void {
    this.droneNode?.stop();
    this.droneNode = null;
  }

  private scheduler(): void {
    if (!this.context || !this.musicPlaying) return;
    while (this.nextNoteTime < this.context.currentTime + SCHEDULE_AHEAD_SECONDS) {
      this.scheduleSixteenth(this.sixteenthIndex, this.nextNoteTime);
      this.nextNoteTime += SIXTEENTH_SECONDS;
      this.sixteenthIndex = (this.sixteenthIndex + 1) % (MAQSUM_PATTERN.length * 4);
    }
  }

  private scheduleSixteenth(index: number, time: number): void {
    const ctx = this.context!;
    const eighthIndex = index % MAQSUM_PATTERN.length;
    const hit = index % 2 === 0 ? MAQSUM_PATTERN[eighthIndex] : null;
    if (hit) this.scheduleDarbuka(ctx, hit, time);

    // A short plucked Hijaz phrase, one note roughly every two eighth-notes.
    if (index % 4 === 0) {
      const phraseStep = (index / 4) % 8;
      const scaleIndex = [0, 2, 1, 3, 4, 3, 2, 0][phraseStep];
      this.schedulePluck(ctx, HIJAZ_ON_D[scaleIndex], time);
    }
  }

  private scheduleDarbuka(ctx: AudioContext, hit: 'doum' | 'tek', time: number): void {
    const gain = ctx.createGain();
    gain.connect(this.musicGain!);
    if (hit === 'doum') {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(140, time);
      osc.frequency.exponentialRampToValueAtTime(55, time + 0.12);
      gain.gain.setValueAtTime(0.9, time);
      gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.22);
      osc.connect(gain);
      osc.start(time);
      osc.stop(time + 0.24);
    } else {
      const noise = this.noiseBurst(ctx, 0.06);
      const filter = ctx.createBiquadFilter();
      filter.type = 'highpass';
      filter.frequency.value = 1800;
      gain.gain.setValueAtTime(0.5, time);
      gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.07);
      noise.connect(filter);
      filter.connect(gain);
      noise.start(time);
      noise.stop(time + 0.08);
    }
  }

  private schedulePluck(ctx: AudioContext, frequency: number, time: number): void {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.value = frequency;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(2200, time);
    filter.frequency.exponentialRampToValueAtTime(500, time + 0.3);
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(0.35, time + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.35);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.musicGain!);
    osc.start(time);
    osc.stop(time + 0.4);
  }

  private noiseBurst(ctx: AudioContext, duration: number): AudioBufferSourceNode {
    const frameCount = Math.max(1, Math.floor(ctx.sampleRate * duration));
    const buffer = ctx.createBuffer(1, frameCount, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frameCount; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    return source;
  }

  dispose(): void {
    this.stopMusic();
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.visibilityHandler);
    }
    void this.context?.close();
    this.context = null;
  }
}
