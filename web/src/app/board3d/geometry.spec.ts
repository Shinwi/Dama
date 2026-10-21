import { createInitialBoard, parseSquare } from '../../engine/board';
import { DARK, LIGHT } from '../../engine/types';
import { cameraTilt, capturedDiscs, fitDistance, hopDurations, pileSlot, shortestTurn, squareToWorld, worldToSquare } from './geometry';

describe('3D board geometry', () => {
  it('puts a1 at the near left corner and j10 at the far right, as Light sees it', () => {
    expect(squareToWorld(parseSquare('a1'))).toEqual({ x: -4.5, y: 0, z: 4.5 });
    expect(squareToWorld(parseSquare('j10'))).toEqual({ x: 4.5, y: 0, z: -4.5 });
  });

  it('maps every playable square back to itself, anywhere on the square', () => {
    for (let square = 0; square < 100; square++) {
      if ((Math.floor(square / 10) + (square % 10)) % 2 !== 0) continue;
      const { x, z } = squareToWorld(square);
      for (const [dx, dz] of [[0, 0], [0.45, 0.45], [-0.45, -0.45], [0.45, -0.45]]) {
        expect(worldToSquare(x + dx, z + dz)).toBe(square);
      }
    }
  });

  it('finds no square on light squares or off the board', () => {
    const b1 = squareToWorld(parseSquare('a1'));
    expect(worldToSquare(b1.x + 1, b1.z)).toBeNull();
    expect(worldToSquare(-5.2, 0)).toBeNull();
    expect(worldToSquare(0, 5.2)).toBeNull();
  });

  it('counts captured discs, a king counting as two', () => {
    const board = createInitialBoard();
    expect(capturedDiscs(board, LIGHT)).toBe(0);
    expect(capturedDiscs(board, DARK)).toBe(0);
    board[parseSquare('a1')] = 0;
    board[parseSquare('c1')] = 0;
    board[parseSquare('e1')] = 2;
    expect(capturedDiscs(board, LIGHT)).toBe(1);
  });

  it('piles captured discs in fives, beside the board, on opposite sides for the two colours', () => {
    const first = pileSlot(LIGHT, 0);
    expect(pileSlot(LIGHT, 4).y).toBeGreaterThan(first.y);
    expect(pileSlot(LIGHT, 5).y).toBeCloseTo(first.y);
    expect(first.x).toBeGreaterThan(5.8);
    expect(pileSlot(DARK, 0).x).toBeLessThan(-5.8);
  });

  it('keeps even the longest multi-jump well within GameService\'s 5 s wait', () => {
    const path = Array.from({ length: 12 }, (_, i) => (i % 2 === 0 ? 0 : 99));
    const total = hopDurations(path, true).reduce((a, b) => a + b, 0);
    expect(total).toBeLessThanOrEqual(3200.001);
    expect(hopDurations([parseSquare('b4'), parseSquare('a5')], false)).toEqual([330]);
  });

  it('turns the short way round', () => {
    expect(shortestTurn(0, Math.PI * 1.5)).toBeCloseTo(-Math.PI / 2);
    expect(shortestTurn(Math.PI * 1.5, 0)).toBeCloseTo(Math.PI / 2);
  });

  it('backs the camera off further on a narrow screen', () => {
    expect(fitDistance(38, 0.6)).toBeGreaterThan(fitDistance(38, 1));
  });

  it('looks down more steeply on a tall (full-screen phone) view', () => {
    expect(cameraTilt(1)).toBeCloseTo(0.92);
    expect(cameraTilt(1.6)).toBeCloseTo(0.92);
    expect(cameraTilt(0.5)).toBeLessThan(cameraTilt(0.8));
  });
});
