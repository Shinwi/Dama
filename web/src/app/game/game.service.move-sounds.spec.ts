import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DARK, LIGHT } from '../../engine/types';
import { AudioService } from '../audio/audio.service';
import { GameService } from './game.service';

/** Records which sounds the game asks for, instead of playing them. */
function fakeAudio() {
  const played: string[] = [];
  const record = (name: string) => () => played.push(name);
  return {
    played,
    setSoundOn: () => {},
    setMusicOn: () => {},
    unlock: () => {},
    moveTap: record('moveTap'),
    capture: record('capture'),
    kingCapture: record('kingCapture'),
    kingCaptured: record('kingCaptured'),
    kingLost: record('kingLost'),
    promotion: record('promotion'),
    win: record('win'),
    loss: record('loss'),
  };
}

describe('GameService move sounds', () => {
  let service: GameService;
  let audio: ReturnType<typeof fakeAudio>;

  beforeEach(() => {
    localStorage.setItem(
      'dama.settings.v1',
      JSON.stringify({ mode: 'computer', playerSide: LIGHT }),
    );
    audio = fakeAudio();
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection(), { provide: AudioService, useValue: audio }],
    });
    service = TestBed.inject(GameService);
    // The test plays both sides itself; the computer answers at once, with no move.
    (service as unknown as { ai: unknown }).ai = { chooseTurn: async () => null };
  });

  afterEach(() => localStorage.clear());

  /** Plays the first legal move for whoever is to move, as the player or the computer would. */
  function playAny(): void {
    const controller = service['controller'];
    controller.applyExternalMove(controller.legalMoves[0]);
    service['startMove']();
    service['bump']();
    TestBed.tick();
    service.boardSettled();
  }

  it('plays a sound for each move played, but none on Undo', async () => {
    playAny(); // player (Light)
    expect(service.state().toMove).toBe(DARK);
    playAny(); // reply (Dark)
    playAny(); // player
    playAny(); // reply
    expect(audio.played).toHaveLength(4);
    await new Promise((resolve) => setTimeout(resolve));
    expect(service.thinking()).toBe(false);

    service.undo();
    expect(service.state().toMove).toBe(LIGHT);
    TestBed.tick();
    expect(audio.played).toHaveLength(4);
  });
});
