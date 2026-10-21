import { colOf, rowOf } from '../../engine/board';
import { BoardArray, LIGHT, Side } from '../../engine/types';

/**
 * Where things sit in the 3D scene. Pure numbers, no Three.js, so it can be unit tested.
 *
 * One square is one world unit. The board's top face is at y = 0, centred on the origin.
 * Rank 1 (Light's home row) is nearest +z, file a nearest -x: seen from +z (Light's side of
 * the table) the board reads like the 2D board does.
 */

/** Pieces of one colour, 20 a side. */
export const PIECES_PER_SIDE = 20;
/** Height of one disc. A king is two discs stacked. */
export const DISC_HEIGHT = 0.25;
/** Half the width of the board including its frame. */
export const FRAME_HALF = 5.8;
/** Height of the board (its frame) above the brass tray it stands on. */
export const BOARD_HEIGHT = 0.5;
/** The top of the brass tray, where captured pieces are stacked. */
export const TRAY_Y = -BOARD_HEIGHT;
/** Captured pieces are stacked in piles of this many. */
const PILE_SIZE = 5;

export interface Point3 {
  x: number;
  y: number;
  z: number;
}

/** Centre of a square on the board's top face. */
export function squareToWorld(square: number): Point3 {
  return { x: colOf(square) - 4.5, y: 0, z: 4.5 - rowOf(square) };
}

/** The playable square under a point on the board, or null (off the board, or a light square). */
export function worldToSquare(x: number, z: number): number | null {
  const col = Math.floor(x + 5);
  const row = Math.floor(5 - z);
  if (col < 0 || col > 9 || row < 0 || row > 9) return null;
  if ((row + col) % 2 !== 0) return null;
  return row * 10 + col;
}

/**
 * How many discs of `side`'s colour lie captured beside the board: every disc that's not on
 * the board, a king counting as two. In dama a man is crowned with one of its own captured
 * pieces, so a promotion takes a disc back off the pile (when there is one).
 */
export function capturedDiscs(board: BoardArray, side: Side): number {
  let onBoard = 0;
  for (const cell of board) {
    if (Math.sign(cell) === side) onBoard += Math.abs(cell);
  }
  return Math.max(0, PIECES_PER_SIDE - onBoard);
}

/**
 * Where the `index`th captured disc of `side`'s colour goes: piles of five on the tray, to
 * the right of the board as Light sees it for Light's colour, to the left for Dark's. Each
 * disc is a little off true, as if put down by hand.
 */
export function pileSlot(side: Side, index: number): Point3 & { turn: number } {
  const pile = Math.floor(index / PILE_SIZE);
  const level = index % PILE_SIZE;
  const across = side === LIGHT ? 1 : -1;
  const wobble = Math.sin(index * 12.9898) * 0.035;
  return {
    x: across * (FRAME_HALF + 0.75) + wobble,
    y: TRAY_Y + level * DISC_HEIGHT,
    z: across * (pile - 1.5) * 0.92 + Math.cos(index * 7.233) * 0.035,
    turn: index * 1.7,
  };
}

/** Diagonal distance in squares between two squares. */
export function squareDistance(a: number, b: number): number {
  return Math.max(Math.abs(colOf(a) - colOf(b)), Math.abs(rowOf(a) - rowOf(b)));
}

/** Longest a move may take to play out: GameService gives up waiting after 5 s. */
const MAX_MOVE_MS = 3200;

/**
 * How long each hop of a move takes, in ms. A flying king's long hop takes a little longer
 * than a step to the next square, and a long multi-jump is sped up so that it still finishes
 * well within GameService's wait.
 */
export function hopDurations(path: number[], isCapture: boolean): number[] {
  const hops: number[] = [];
  for (let i = 1; i < path.length; i++) {
    const distance = squareDistance(path[i - 1], path[i]);
    hops.push((isCapture ? 380 : 330) + 35 * (distance - 1));
  }
  const total = hops.reduce((sum, ms) => sum + ms, 0);
  const scale = total > MAX_MOVE_MS ? MAX_MOVE_MS / total : 1;
  return hops.map((ms) => ms * scale);
}

/** How high a piece arcs on a hop of `distance` squares. */
export function hopHeight(distance: number, isCapture: boolean): number {
  return isCapture ? 0.85 + 0.09 * distance : 0.45;
}

/** The angle to turn by to get from `from` to `to` the short way round. */
export function shortestTurn(from: number, to: number): number {
  const full = Math.PI * 2;
  let delta = (to - from) % full;
  if (delta > Math.PI) delta -= full;
  if (delta < -Math.PI) delta += full;
  return delta;
}

/** 0 for a square or wide view, rising to 1 for a phone held upright (full screen). */
function tallness(aspect: number): number {
  return Math.min(1, Math.max(0, (1 - aspect) / 0.5));
}

/**
 * How far away the camera has to be for the board and the captured piles beside it to fit
 * the view, for a vertical field of view of `fovDeg` and a width/height `aspect`. On a tall
 * view, only the board itself has to fit across: the piles may be cut off at the sides.
 */
export function fitDistance(fovDeg: number, aspect: number): number {
  const halfV = (fovDeg * Math.PI) / 360;
  const halfH = Math.atan(Math.tan(halfV) * aspect);
  const across = 8.6 - 2.1 * tallness(aspect);
  return Math.max(across / Math.tan(halfH), 6.9 / Math.tan(halfV));
}

/**
 * The camera's angle from straight down, at rest. On a tall view it looks down more steeply,
 * so the board fills the height instead of sitting in a band across the middle.
 */
export function cameraTilt(aspect: number): number {
  return 0.92 - 0.36 * tallness(aspect);
}

export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

export function easeOutBack(t: number): number {
  const c = 1.9;
  return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2;
}
