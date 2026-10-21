import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { App } from './app';
import { GameService } from './game/game.service';
import { boardFrom } from '../engine/board';
import { DARK } from '../engine/types';

describe('App accessibility', () => {
  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideZonelessChangeDetection()],
    }).compileComponents();
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

    // Starting the new game from the card puts focus back on the board, on its Tab stop.
    (document.activeElement as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('[data-testid="game-over"]')).toBeNull();
    expect(document.activeElement?.closest('.board')).not.toBeNull();
    expect(document.activeElement?.getAttribute('tabindex')).toBe('0');
  });

  it('has a live region for move announcements', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const region = fixture.nativeElement.querySelector('[data-testid="announcement"]');
    expect(region.getAttribute('aria-live')).toBe('polite');
  });
});
