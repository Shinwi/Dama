import { Injectable } from '@angular/core';
import { SoundEngine } from './sound-engine';

/** Thin Angular wrapper so components don't touch Web Audio directly. */
@Injectable({ providedIn: 'root' })
export class AudioService {
  private readonly engine = typeof AudioContext !== 'undefined' ? new SoundEngine() : null;
  private soundOn = true;
  private musicOn = false;

  setSoundOn(on: boolean): void {
    this.soundOn = on;
  }

  setMusicOn(on: boolean): void {
    this.musicOn = on;
    if (!this.engine) return;
    if (on) {
      this.engine.unlock();
      this.engine.startMusic();
    } else {
      this.engine.stopMusic();
    }
  }

  /** Call from a click/tap handler so the AudioContext can start (browsers require a gesture). */
  unlock(): void {
    this.engine?.unlock();
  }

  click(): void {
    if (this.soundOn) this.engine?.playClick();
  }

  /** A refused tap: short and soft, so it's no fuss to hear a few times. */
  /** The move timer's last seconds: one soft tick a second. */
  clockTick(): void {
    if (this.soundOn) this.engine?.playClockTick();
  }

  nope(): void {
    if (this.soundOn) this.engine?.playNope();
  }

  moveTap(): void {
    if (this.soundOn) this.engine?.playMoveTap();
  }

  capture(count: number): void {
    if (this.soundOn) this.engine?.playCapture(count);
  }

  kingCapture(count: number): void {
    if (this.soundOn) this.engine?.playKingCapture(count);
  }

  kingCaptured(): void {
    if (this.soundOn) this.engine?.playKingCaptured();
  }

  kingLost(): void {
    if (this.soundOn) this.engine?.playKingLost();
  }

  promotion(): void {
    if (this.soundOn) this.engine?.playPromotion();
  }

  win(): void {
    if (this.soundOn) this.engine?.playWin();
  }

  loss(): void {
    if (this.soundOn) this.engine?.playLoss();
  }
}
