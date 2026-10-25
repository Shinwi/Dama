import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { parseSquare } from '../../engine/board';
import { createInitialState, legalMoves } from '../../engine/game';
import { moveNotation } from '../../engine/moves';
import { DARK, LIGHT } from '../../engine/types';
import { Ply } from '../game/game-controller';
import { MoveList, plyNotation } from './move-list';

const move = (notation: string) => {
  // Any legal opening move will do for the list's text; these all are.
  return legalMoves(createInitialState()).find((m) => moveNotation(m) === notation)!;
};

describe('MoveList', () => {
  it('numbers the moves in White/Black pairs, under who played them', async () => {
    TestBed.configureTestingModule({ imports: [MoveList], providers: [provideZonelessChangeDetection()] });
    const fixture = TestBed.createComponent(MoveList);
    const plies: Ply[] = [
      { side: LIGHT, nfikh: null, move: move('b4-a5') },
      { side: DARK, nfikh: null, move: null },
      { side: LIGHT, nfikh: null, move: move('d4-c5') },
    ];
    fixture.componentRef.setInput('plies', plies);
    fixture.componentRef.setInput('names', { light: 'You', dark: 'Opponent' });
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const rows = [...el.querySelectorAll('tbody tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent?.trim()));
    expect(rows).toEqual([
      ['1', 'b4-a5', 'out of time'],
      ['2', 'd4-c5', ''],
    ]);
    expect([...el.querySelectorAll('th')].map((th) => th.textContent?.trim())).toEqual(['#', 'You', 'Opponent']);
    expect(el.querySelector('[data-testid="move-summary"]')?.textContent?.trim()).toBe('2. You d4-c5');
  });

  it('writes an nfikh before the move that follows it', () => {
    expect(plyNotation({ side: DARK, nfikh: parseSquare('d6'), move: null })).toBe('nfikh d6, out of time');
    expect(plyNotation({ side: LIGHT, nfikh: parseSquare('d6'), move: move('b4-a5') })).toBe('nfikh d6, b4-a5');
  });
});
