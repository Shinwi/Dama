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

  moveTap(): void {
    if (this.soundOn) this.engine?.playMoveTap();
  }

  capture(): void {
    if (this.soundOn) this.engine?.playCapture();
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
