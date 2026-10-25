import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { parseSquare } from '../../engine/board';
import { DARK, LIGHT } from '../../engine/types';
import { AudioService } from '../audio/audio.service';
import { GameService } from './game.service';

const sq = parseSquare;

/** A service whose clock the test moves by hand, recording the sounds it plays. */
function setUp(settings: Record<string, unknown>) {
  localStorage.setItem('dama.settings.v1', JSON.stringify(settings));
  const played: string[] = [];
  const audio = new Proxy({}, { get: (_t, name: string) => () => played.push(name) });
  TestBed.configureTestingModule({
    providers: [provideZonelessChangeDetection(), { provide: AudioService, useValue: audio }],
  });
  const service = TestBed.inject(GameService);
  let time = 1_000_000;
  const internals = service as unknown as { now: () => number; clockTick: () => void };
  internals.now = () => time;
  service.newGame();
  played.length = 0;
  /** Moves the clock on, and lets the service look at it. */
  const wait = (ms: number) => {
    time += ms;
    internals.clockTick();
  };
  return { service, played, wait };
}

describe('GameService move timer (offline)', () => {
  afterEach(() => {
    TestBed.inject(GameService).leaveOnline(); // stops the clock
    localStorage.clear();
  });

  it('runs for the player to move, from the move timer setting', () => {
    const { service, wait } = setUp({ mode: 'pvp', moveTime: 30 });
    expect(service.turnClock()).toMatchObject({ side: LIGHT, totalMs: 30_000 });
    wait(12_000);
    expect(service.turnLeftMs()).toBe(18_000);
  });

  it('skips the turn when the time is up', () => {
    const { service, wait } = setUp({ mode: 'pvp', moveTime: 30 });
    service.tapSquare(sq('b4')); // picked up a piece, then ran out of time
    wait(30_000);
    expect(service.state().toMove).toBe(DARK);
    expect(service.lastTimeout()).toBe(LIGHT);
    expect(service.selection().selected).toBeNull();
    expect(service.plies()).toEqual([{ side: LIGHT, nfikh: null, move: null }]);
    expect(service.turnClock()).toMatchObject({ side: DARK, totalMs: 30_000 });
    expect(service.announcement()).toBe('White ran out of time: the turn is skipped.');
  });

  it('three time-outs in a row lose the game', () => {
    const { service, wait } = setUp({ mode: 'pvp', moveTime: 30 });
    const blackMoves = [
      ['c7', 'b6'],
      ['b6', 'a5'],
    ];
    for (const [from, to] of blackMoves) {
      wait(30_000); // White's turn skipped
      service.tapSquare(sq(from));
      service.tapSquare(sq(to));
      service.boardSettled();
    }
    wait(30_000);
    expect(service.outcome()).toEqual({ kind: 'win', winner: DARK, onTime: true });
    expect(service.turnClock()).toBeNull();
  });

  it('has no clock for the computer, nor without a timer', () => {
    const vsComputer = setUp({ mode: 'computer', playerSide: DARK, moveTime: 30 });
    expect(vsComputer.service.state().toMove).toBe(LIGHT); // the computer's turn first
    expect(vsComputer.service.turnClock()).toBeNull();
    TestBed.resetTestingModule();
    const noTimer = setUp({ mode: 'pvp', moveTime: 0 });
    expect(noTimer.service.turnClock()).toBeNull();
  });

  it('waits for a move to land before the next clock starts', () => {
    const { service, wait } = setUp({ mode: 'pvp', moveTime: 30 });
    service.tapSquare(sq('b4'));
    service.tapSquare(sq('a5'));
    expect(service.turnClock()).toBeNull(); // still sliding
    wait(40_000);
    expect(service.state().toMove).toBe(DARK); // nobody's time ran out meanwhile
    service.boardSettled();
    expect(service.turnClock()).toMatchObject({ side: DARK });
    expect(service.turnLeftMs()).toBe(30_000);
  });

  it('ticks once a second through the last 10 seconds', () => {
    const { played, wait } = setUp({ mode: 'pvp', moveTime: 30 });
    wait(19_000);
    expect(played).toEqual([]);
    for (let i = 0; i < 8; i++) wait(250); // 10.75 s .. 9 s left
    expect(played.filter((sound) => sound === 'clockTick')).toHaveLength(2);
  });
});

describe('GameService taps made while a move is still sliding (issue #32)', () => {
  afterEach(() => localStorage.clear());

  it('plays them once the move has landed, a move at a time', () => {
    const { service } = setUp({ mode: 'pvp', moveTime: 0 });
    for (const square of ['b4', 'a5', 'c7', 'b6', 'j4', 'i5']) service.tapSquare(sq(square));
    service.boardSettled(); // b4-a5 lands: c7-b6 is played
    expect(service.lastMove()?.from).toBe(sq('c7'));
    service.boardSettled(); // c7-b6 lands: j4-i5 is played
    expect(service.lastMove()?.from).toBe(sq('j4'));
    service.boardSettled();
    expect(service.plies()).toHaveLength(3);
    expect(service.state().toMove).toBe(DARK);
  });
});
