import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { boardFrom, parseSquare } from '../../engine/board';
import { Board } from './board';

describe('Board accessibility', () => {
  let fixture: ComponentFixture<Board>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Board],
      providers: [provideZonelessChangeDetection()],
    }).compileComponents();
    fixture = TestBed.createComponent(Board);
    fixture.componentRef.setInput('board', boardFrom({ light: ['b4', 'c3'], darkKings: ['e7'] }));
  });

  const square = (name: string): HTMLButtonElement =>
    fixture.nativeElement.querySelector(`button[data-square="${name}"]`);
  const label = (name: string) => square(name).getAttribute('aria-label');
  const press = (key: string) => {
    (document.activeElement as HTMLElement).dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true }),
    );
  };
  const focused = () => (document.activeElement as HTMLElement).getAttribute('data-square');

  it('says what is on each square', async () => {
    await fixture.whenStable();
    expect(label('b4')).toBe('b4, light man');
    expect(label('e7')).toBe('e7, dark king');
    expect(label('a1')).toBe('a1, empty');
  });

  it('says which piece is selected and where it can go', async () => {
    fixture.componentRef.setInput('selected', parseSquare('b4'));
    fixture.componentRef.setInput('landingDots', [parseSquare('a5'), parseSquare('c5')]);
    fixture.componentRef.setInput('compulsoryRings', [parseSquare('c3')]);
    await fixture.whenStable();
    expect(label('b4')).toBe('b4, light man, selected');
    expect(label('a5')).toBe('a5, empty, you can move here');
    expect(label('c3')).toBe('c3, light man, must capture');

    fixture.componentRef.setInput('landingDots', []);
    fixture.componentRef.setInput('captureRings', [parseSquare('f8')]);
    await fixture.whenStable();
    expect(label('f8')).toBe('f8, empty, you can capture by moving here');
  });

  it('is a single Tab stop, on the bottom-left square to start with', async () => {
    await fixture.whenStable();
    const stops = fixture.nativeElement.querySelectorAll('button[tabindex="0"]');
    expect(stops).toHaveLength(1);
    expect(stops[0].getAttribute('data-square')).toBe('a1');
  });

  it('moves focus between playable squares with the arrow keys', async () => {
    await fixture.whenStable();
    square('a1').focus();
    press('ArrowRight');
    expect(focused()).toBe('c1');
    press('ArrowUp');
    expect(focused()).toBe('d2');
    press('ArrowDown');
    expect(focused()).toBe('c1');
    press('ArrowLeft');
    press('ArrowLeft'); // already at the edge: stays put
    expect(focused()).toBe('a1');
    press('ArrowUp');
    press('ArrowUp');
    expect(focused()).toBe('c3');

    // The Tab stop follows focus.
    await fixture.whenStable();
    expect(square('c3').getAttribute('tabindex')).toBe('0');
    expect(square('a1').getAttribute('tabindex')).toBe('-1');
  });

  it('follows the board as drawn when it is flipped', async () => {
    fixture.componentRef.setInput('flipped', true);
    await fixture.whenStable();
    const start = fixture.nativeElement.querySelector('button[tabindex="0"]') as HTMLButtonElement;
    expect(start.getAttribute('data-square')).toBe('j10');
    start.focus();
    press('ArrowRight'); // rightwards on screen is towards a, when flipped
    expect(focused()).toBe('h10');
    press('ArrowUp');
    expect(focused()).toBe('g9');
  });

  it('is a labelled group, not an (invalid) grid', async () => {
    await fixture.whenStable();
    const board = fixture.nativeElement.querySelector('.board');
    expect(board.getAttribute('role')).toBe('group');
    expect(board.getAttribute('aria-label')).toBe('Dama board');
  });
});
