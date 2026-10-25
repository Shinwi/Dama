import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { boardFrom, parseSquare } from '../../engine/board';
import { LIGHT } from '../../engine/types';
import { AudioService } from '../audio/audio.service';
import { GameService } from './game.service';

const sq = parseSquare;

function setUp(mode: 'pvp' | 'computer') {
  localStorage.setItem('dama.settings.v1', JSON.stringify({ mode, playerSide: LIGHT }));
  const played: string[] = [];
  const noop = () => {};
  const audio = new Proxy({}, { get: (_t, name: string) => (name === 'nope' ? () => played.push('nope') : noop) });
  TestBed.configureTestingModule({
    providers: [provideZonelessChangeDetection(), { provide: AudioService, useValue: audio }],
  });
  const service = TestBed.inject(GameService);
  return { service, played };
}

describe('GameService refused taps', () => {
  afterEach(() => localStorage.clear());

  it('says what is wrong, plays the "nope" sound, and shakes the selected piece', () => {
    const { service, played } = setUp('pvp');
    service.tapSquare(sq('b4'));
    service.tapSquare(sq('e5')); // not where b4 can go

    expect(service.tapFeedback()).toMatchObject({ square: sq('e5'), shake: sq('b4'), message: "That piece can't go there." });
    expect(played).toEqual(['nope']);
    expect(service.selection().selected).toBe(sq('b4')); // still holding it
  });

  it('gives each refusal its own id, so the board shakes again', () => {
    const { service } = setUp('pvp');
    service.tapSquare(sq('e5'));
    const first = service.tapFeedback()!.id;
    service.tapSquare(sq('e5'));
    expect(service.tapFeedback()!.id).not.toBe(first);
    expect(service.tapFeedback()!.message).toBe('Pick one of your pieces first.');
    expect(service.tapFeedback()!.shake).toBeNull(); // nothing there to shake
  });

  it('the message goes away by itself', async () => {
    const { service } = setUp('pvp');
    service.tapSquare(sq('e5'));
    expect(service.tapFeedback()).not.toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 1900));
    expect(service.tapFeedback()).toBeNull();
  });

  it('picking a piece up and putting it down gets no feedback', () => {
    const { service, played } = setUp('pvp');
    service.tapSquare(sq('b4'));
    service.tapSquare(sq('b4'));
    expect(service.tapFeedback()).toBeNull();
    expect(played).toEqual([]);
  });

  it("vs the computer, tapping during the computer's turn says to wait", () => {
    const { service } = setUp('computer');
    const controller = service['controller'];
    controller.state = { ...controller.state, board: boardFrom({ light: ['c3'], dark: ['j10'] }), toMove: -1 };
    service.tapSquare(sq('c3'));
    expect(service.tapFeedback()?.message).toBe("Wait for the computer's move.");
  });
});
