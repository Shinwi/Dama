import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DARK, LIGHT } from '../../engine/types';
import { CapturedStacks } from './captured-stacks';
import { formatClock, Scoreboard, ScoreboardPlayer } from './scoreboard';

const players: [ScoreboardPlayer, ScoreboardPlayer] = [
  { side: LIGHT, name: 'You', captured: 7, turnLabel: 'Your move' },
  { side: DARK, name: 'Opponent', captured: 5, turnLabel: 'To move' },
];

describe('Scoreboard', () => {
  let fixture: ComponentFixture<Scoreboard>;
  const el = () => fixture.nativeElement as HTMLElement;
  const text = (id: string) => el().querySelector(`[data-testid="${id}"]`)?.textContent?.trim();

  beforeEach(async () => {
    TestBed.configureTestingModule({ imports: [Scoreboard], providers: [provideZonelessChangeDetection()] });
    fixture = TestBed.createComponent(Scoreboard);
    fixture.componentRef.setInput('players', players);
    fixture.componentRef.setInput('toMove', LIGHT);
    fixture.componentRef.setInput('moveTimeMs', 30_000);
    fixture.componentRef.setInput('clock', { side: LIGHT, leftMs: 23_400 });
    await fixture.whenStable();
  });

  it('shows the names, the pieces each has captured, and both clocks', () => {
    expect(text('name-light')).toBe('You');
    expect(text('name-dark')).toBe('Opponent');
    expect(text('score-light')).toBe('7');
    expect(text('score-dark')).toBe('5');
    expect(text('clock-light')).toBe('0:24');
    expect(text('clock-dark')).toBe('0:30'); // waiting: a full turn
  });

  it('lights up the player to move, in red for their last 10 seconds', async () => {
    const tab = () => el().querySelectorAll('.tab')[0];
    expect(tab().classList).toContain('active');
    expect(tab().classList).not.toContain('low');
    fixture.componentRef.setInput('clock', { side: LIGHT, leftMs: 9_000 });
    await fixture.whenStable();
    expect(tab().classList).toContain('low');
    expect(el().querySelectorAll('.tab')[1].classList).not.toContain('active');
  });

  it('has no clocks without a move timer', async () => {
    fixture.componentRef.setInput('moveTimeMs', 0);
    fixture.componentRef.setInput('clock', null);
    await fixture.whenStable();
    expect(el().querySelector('[data-testid="clock-light"]')).toBeNull();
  });
});

describe('formatClock', () => {
  it('rounds up to whole seconds, so 0:00 is really the end', () => {
    expect(formatClock(30_000)).toBe('0:30');
    expect(formatClock(9_001)).toBe('0:10');
    expect(formatClock(1)).toBe('0:01');
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(60_000)).toBe('1:00');
  });
});

describe('CapturedStacks', () => {
  it('stacks captured pieces four high', async () => {
    TestBed.configureTestingModule({ imports: [CapturedStacks], providers: [provideZonelessChangeDetection()] });
    const fixture = TestBed.createComponent(CapturedStacks);
    fixture.componentRef.setInput('color', 'dark');
    fixture.componentRef.setInput('count', 7);
    await fixture.whenStable();
    const stacks = [...(fixture.nativeElement as HTMLElement).querySelectorAll('.stack')].map((s) => s.children.length);
    expect(stacks).toEqual([4, 3]);
    expect((fixture.nativeElement as HTMLElement).getAttribute('aria-label')).toBe('7 black pieces captured');
  });
});
