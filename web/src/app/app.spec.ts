import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { App, describeGameOver } from './app';
import { defaultSettings } from './game/game-controller';
import { GameService } from './game/game.service';
import { boardFrom } from '../engine/board';
import { DARK, LIGHT } from '../engine/types';

describe('App', () => {
  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideZonelessChangeDetection()],
    }).compileComponents();
  });

  it('renders the 40 starting pieces', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const pieces = fixture.nativeElement.querySelectorAll('[data-testid="piece"]');
    expect(pieces.length).toBe(40);
  });

  it('shows "Your move." for Light to move at the start', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const status = fixture.nativeElement.querySelector('[data-testid="status"]');
    expect(status.textContent).toContain('Your move.');
  });

  it('offers Undo vs the computer but not in 1v1', () => {
    const undoButton = (fixture: ReturnType<typeof TestBed.createComponent<App>>) =>
      [...fixture.nativeElement.querySelectorAll('button')].find(
        (b: HTMLButtonElement) => b.textContent?.trim() === 'Undo',
      );

    const vsComputer = TestBed.createComponent(App);
    vsComputer.detectChanges();
    expect(undoButton(vsComputer)).toBeDefined();

    localStorage.setItem('dama.settings.v1', JSON.stringify({ mode: 'pvp' }));
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [App],
      providers: [provideZonelessChangeDetection()],
    });
    const pvp = TestBed.createComponent(App);
    pvp.detectChanges();
    expect(undoButton(pvp)).toBeUndefined();
  });

  it('moves focus to "New game" when the game ends', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const game = TestBed.inject(GameService);
    const controller = game['controller'];
    // Dark has no pieces left and is to move: Light has won.
    controller.state = { ...controller.state, board: boardFrom({ light: ['c3'] }), toMove: DARK };
    game['bump']();
    await fixture.whenStable();

    const dialog = fixture.nativeElement.querySelector('[role="dialog"]');
    expect(dialog.getAttribute('aria-labelledby')).toBe('game-over-title');
    expect(document.activeElement?.textContent?.trim()).toBe('New game');
  });

  it('has a live region for move announcements', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const region = fixture.nativeElement.querySelector('[data-testid="announcement"]');
    expect(region.getAttribute('aria-live')).toBe('polite');
  });

  it('does not show the game-over overlay while a game is ongoing', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="game-over"]')).toBeNull();
  });
});

describe('describeGameOver', () => {
  const settings = defaultSettings();

  it('returns null while the game is ongoing', () => {
    expect(describeGameOver({ kind: 'ongoing' }, settings)).toBeNull();
  });

  it('describes a draw', () => {
    const result = describeGameOver({ kind: 'draw' }, settings);
    expect(result?.variant).toBe('neutral');
    expect(result?.title).toBe('Draw');
  });

  it('vs computer: "You win!" when the player is the winner', () => {
    const result = describeGameOver({ kind: 'win', winner: LIGHT }, { ...settings, mode: 'computer', playerSide: LIGHT });
    expect(result?.variant).toBe('win');
    expect(result?.title).toBe('You win!');
  });

  it('vs computer: "You lose" when the computer is the winner', () => {
    const result = describeGameOver({ kind: 'win', winner: DARK }, { ...settings, mode: 'computer', playerSide: LIGHT });
    expect(result?.variant).toBe('loss');
    expect(result?.title).toBe('You lose');
  });

  it('1v1: names the winning side, no "you"', () => {
    const result = describeGameOver({ kind: 'win', winner: DARK }, { ...settings, mode: 'pvp' });
    expect(result?.variant).toBe('win');
    expect(result?.title).toBe('Dark wins!');
    expect(result?.subtitle).toContain('Light');
  });
});
