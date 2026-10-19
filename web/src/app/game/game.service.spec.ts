import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { boardFrom, createInitialBoard, parseSquare } from '../../engine/board';
import { LIGHT } from '../../engine/types';
import { GameService } from './game.service';

/** Puts a URL in the (jsdom) address bar, then creates a fresh GameService that reads it. */
function serviceAt(search: string): GameService {
  history.replaceState(null, '', `/${search}`);
  TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
  return TestBed.inject(GameService);
}

describe('GameService ?position= scenarios', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('dama.settings.v1', JSON.stringify({ mode: 'pvp', soundOn: false }));
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    history.replaceState(null, '', '/');
  });

  it('starts from the standard opening with no position param', () => {
    const game = serviceAt('');
    expect(game.state().board).toEqual(createInitialBoard());
    expect(game.inScenario()).toBe(false);
    expect(game.scenarioError()).toBeNull();
  });

  it('loads a valid position code', () => {
    const game = serviceAt('?position=L:c3;D:d4,f6;t:L');
    expect(game.state().board).toEqual(boardFrom({ light: ['c3'], dark: ['d4', 'f6'] }));
    expect(game.state().toMove).toBe(LIGHT);
    expect(game.inScenario()).toBe(true);
  });

  it('shows the errors and keeps the opening for an invalid code', () => {
    const game = serviceAt('?position=L:b1');
    expect(game.state().board).toEqual(createInitialBoard());
    expect(game.inScenario()).toBe(false);
    expect(game.scenarioError()).toContain('b1 is not a playable square');
  });

  it('restart() replays the scenario and keeps the param', () => {
    const game = serviceAt('?position=L:c3;D:d4,f6');
    game.tapSquare(parseSquare('c3'));
    game.tapSquare(parseSquare('g7'));
    expect(game.state().board).not.toEqual(boardFrom({ light: ['c3'], dark: ['d4', 'f6'] }));

    game.restart({ strictMode: true });
    expect(game.state().board).toEqual(boardFrom({ light: ['c3'], dark: ['d4', 'f6'] }));
    expect(location.search).toContain('position=');
  });

  it('newGame() leaves the scenario and removes the param', () => {
    const game = serviceAt('?position=L:c3;D:d4,f6');
    game.newGame();
    expect(game.state().board).toEqual(createInitialBoard());
    expect(game.inScenario()).toBe(false);
    expect(location.search).toBe('');
  });

  it('newGame() also clears an invalid param and its error', () => {
    const game = serviceAt('?position=nonsense');
    expect(game.scenarioError()).not.toBeNull();
    game.newGame();
    expect(game.scenarioError()).toBeNull();
    expect(location.search).toBe('');
  });
});
