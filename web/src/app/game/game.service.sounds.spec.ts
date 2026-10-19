import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { boardFrom, parseSquare } from '../../engine/board';
import { LIGHT } from '../../engine/types';
import { AudioService } from '../audio/audio.service';
import { GameService } from './game.service';

/** Records which sounds the game asks for, instead of playing them. */
function fakeAudio() {
  const played: string[] = [];
  const record = (name: string) => () => played.push(name);
  const audio = {
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
  return audio;
}

describe('GameService game-over sound', () => {
  let service: GameService;
  let audio: ReturnType<typeof fakeAudio>;

  beforeEach(() => {
    localStorage.setItem('dama.settings.v1', JSON.stringify({ mode: 'pvp' }));
    audio = fakeAudio();
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection(), { provide: AudioService, useValue: audio }],
    });
    service = TestBed.inject(GameService);
  });

  afterEach(() => localStorage.clear());

  it('plays the win jingle once, not again on later taps or setting changes', () => {
    const controller = service['controller'];
    controller.state = {
      ...controller.state,
      board: boardFrom({ light: ['c3'], dark: ['d4'] }),
      toMove: LIGHT,
    };
    controller.resetSelection();

    service.tapSquare(parseSquare('c3'));
    service.tapSquare(parseSquare('e5')); // takes Dark's last piece
    TestBed.tick();
    expect(service.outcome().kind).toBe('win');
    expect(audio.played.filter((s) => s === 'win')).toHaveLength(1);

    service.boardSettled();
    service.tapSquare(parseSquare('a1'));
    service.tapSquare(parseSquare('e5'));
    TestBed.tick();
    service.updateSettings({ soundOn: false });
    TestBed.tick();
    service.updateSettings({ soundOn: true });
    TestBed.tick();
    service.updateSettings({ musicOn: true });
    TestBed.tick();

    expect(audio.played.filter((s) => s === 'win')).toHaveLength(1);
  });

  it('plays it again for a new result after the game is resumed', () => {
    const controller = service['controller'];
    controller.state = {
      ...controller.state,
      board: boardFrom({ light: ['c3'], dark: ['d4'] }),
      toMove: LIGHT,
    };
    controller.resetSelection();
    service.tapSquare(parseSquare('c3'));
    service.tapSquare(parseSquare('e5'));
    TestBed.tick();

    service.newGame();
    TestBed.tick();
    service.boardSettled();
    controller.state = {
      ...controller.state,
      board: boardFrom({ light: ['c3'], dark: ['d4'] }),
      toMove: LIGHT,
    };
    controller.resetSelection();
    service.tapSquare(parseSquare('c3'));
    service.tapSquare(parseSquare('e5'));
    TestBed.tick();

    expect(audio.played.filter((s) => s === 'win')).toHaveLength(2);
  });
});
