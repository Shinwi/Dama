import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { parseSquare } from '../../engine/board';
import { DARK, LIGHT } from '../../engine/types';
import { AudioService } from '../audio/audio.service';
import { GameService } from './game.service';

const sq = parseSquare;

function setUp(settings: Record<string, unknown>) {
  localStorage.setItem('dama.settings.v1', JSON.stringify({ moveTime: 0, ...settings }));
  const noop = () => {};
  TestBed.configureTestingModule({
    providers: [provideZonelessChangeDetection(), { provide: AudioService, useValue: new Proxy({}, { get: () => noop }) }],
  });
  const service = TestBed.inject(GameService);
  let time = 1_000_000;
  (service as unknown as { now: () => number }).now = () => time;
  service.newGame();
  return { service, wait: (ms: number) => (time += ms) };
}

describe('GameService quick reactions', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
  });

  it('shows your reaction, then the computer answers, and both go away', () => {
    const { service } = setUp({ mode: 'computer', playerSide: LIGHT });
    service.sendReaction('good-move');
    expect(service.reaction()).toMatchObject({ by: LIGHT, reaction: 'good-move' });
    vi.advanceTimersByTime(1200);
    expect(service.reaction()).toMatchObject({ by: DARK, reaction: 'happy' });
    vi.advanceTimersByTime(3000);
    expect(service.reaction()).toBeNull();
  });

  it('ignores a reaction sent too soon after the last', () => {
    const { service, wait } = setUp({ mode: 'pvp' });
    service.sendReaction('happy');
    wait(500);
    service.sendReaction('wow');
    expect(service.reaction()?.reaction).toBe('happy');
    wait(1500);
    service.sendReaction('wow');
    expect(service.reaction()?.reaction).toBe('wow');
  });

  it('in 1v1, comes from the side to move', () => {
    const { service } = setUp({ mode: 'pvp' });
    service.tapSquare(sq('b4'));
    service.tapSquare(sq('a5'));
    service.boardSettled();
    service.sendReaction('oops');
    expect(service.reaction()?.by).toBe(DARK);
  });

  it('online, waits until the server passes reactions on', () => {
    const { service } = setUp({ mode: 'pvp' });
    service.online.set({ side: LIGHT, opponentJoined: true, connection: 'connected' } as never);
    expect(service.reactionsAvailable()).toBe(false);
    service.serverFeatures.set(['reactions']);
    expect(service.reactionsAvailable()).toBe(true);
    service.online.set(null);
  });
});

describe('GameService "Play someone"', () => {
  afterEach(() => localStorage.clear());

  it("says it's coming soon when the server can't match players yet", async () => {
    const { service } = setUp({ mode: 'computer' });
    await service.findMatch({ moveTime: 30 });
    expect(service.matchmaking()).toMatchObject({ state: 'unavailable' });
    service.cancelMatch();
    expect(service.matchmaking()).toBeNull();
  });
});

describe('GameService game stats and combos', () => {
  afterEach(() => localStorage.clear());

  it('counts moves and the best multi-capture, and how long the game took', () => {
    const { service, wait } = setUp({ mode: 'pvp' });
    // b4-c5, e7-d6, c5xe7: one capture by White.
    for (const [from, to] of [
      ['b4', 'c5'],
      ['e7', 'd6'],
      ['c5', 'e7'],
    ]) {
      service.tapSquare(sq(from));
      service.tapSquare(sq(to));
      service.boardSettled();
    }
    wait(65_000);
    expect(service.stats()).toEqual({ moves: 3, bestCombo: { light: 1, dark: 0 }, durationMs: 65_000 });
    expect(service.combo()).toBeNull(); // one piece is no combo
  });
});
