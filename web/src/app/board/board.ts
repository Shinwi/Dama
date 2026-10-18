import { ChangeDetectionStrategy, Component, computed, effect, input, output, signal, untracked } from '@angular/core';
import { colOf, rowOf, squareName } from '../../engine/board';
import { BoardArray, Move } from '../../engine/types';

interface CellView {
  key: number;
  square: number;
  playable: boolean;
  name: string;
  selected: boolean;
  onPath: boolean;
  isLandingDot: boolean;
  isCaptureRing: boolean;
  isCompulsoryRing: boolean;
  isLastMove: boolean;
}

interface PieceState {
  id: string;
  square: number;
  color: 'light' | 'dark';
  king: boolean;
  captured: boolean;
}

interface PieceView extends PieceState {
  top: number;
  left: number;
}

const MOVE_HOP_MS = 170;
const CAPTURE_HOP_MS = 210;

@Component({
  selector: 'app-board',
  templateUrl: './board.html',
  styleUrl: './board.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Board {
  readonly board = input.required<BoardArray>();
  readonly flipped = input(false);
  readonly selected = input<number | null>(null);
  readonly pathSoFar = input<number[]>([]);
  readonly landingDots = input<number[]>([]);
  readonly captureRings = input<number[]>([]);
  readonly compulsoryRings = input<number[]>([]);
  readonly lastMove = input<Move | null>(null);
  /** 'move' animates `lastMove` hop by hop; 'reset' (new game / undo) snaps instantly. */
  readonly updateKind = input<'reset' | 'move'>('reset');

  readonly squareTap = output<number>();

  private readonly pieceStates = signal<PieceState[]>([]);
  private animationToken = 0;
  /** True while `reconcile()` is still replaying a move hop by hop. */
  private animating = false;
  /** The board the latest `reconcile()` is heading for — what the pieces show once it's done. */
  private targetBoard: BoardArray | null = null;

  readonly cells = computed<CellView[]>(() => {
    const board = this.board();
    const flipped = this.flipped();
    const selected = this.selected();
    const path = new Set(this.pathSoFar());
    const dots = new Set(this.landingDots());
    const rings = new Set(this.captureRings());
    const compulsory = new Set(this.compulsoryRings());
    const lastMoveSquares = new Set(this.lastMove()?.path ?? []);

    const result: CellView[] = [];
    for (let visualRow = 0; visualRow < 10; visualRow++) {
      for (let visualCol = 0; visualCol < 10; visualCol++) {
        const row = flipped ? visualRow : 9 - visualRow;
        const col = flipped ? 9 - visualCol : visualCol;
        const square = row * 10 + col;
        const playable = (row + col) % 2 === 0;
        result.push({
          key: visualRow * 10 + visualCol,
          square,
          playable,
          name: playable ? squareName(square) : '',
          selected: playable && selected === square,
          onPath: playable && path.has(square),
          isLandingDot: playable && dots.has(square),
          isCaptureRing: playable && rings.has(square),
          isCompulsoryRing: playable && compulsory.has(square),
          isLastMove: playable && lastMoveSquares.has(square),
        });
      }
    }
    return result;
  });

  readonly pieces = computed<PieceView[]>(() => {
    const flipped = this.flipped();
    return this.pieceStates().map((piece) => {
      const row = rowOf(piece.square);
      const col = colOf(piece.square);
      const visualRow = flipped ? row : 9 - row;
      const visualCol = flipped ? 9 - col : col;
      return { ...piece, top: visualRow * 10, left: visualCol * 10 };
    });
  });

  constructor() {
    effect(() => {
      const board = this.board();
      const kind = this.updateKind();
      const move = this.lastMove();
      // reconcile() reads and writes `pieceStates` itself; keep that untracked so this
      // effect depends only on the inputs above, not on the piece state it's updating
      // (otherwise the write re-dirties the effect's own dependency and it reruns forever).
      untracked(() => void this.reconcile(board, kind, move));
    });
  }

  tap(cell: CellView): void {
    if (!cell.playable) return;
    this.squareTap.emit(cell.square);
  }

  squareNameFor(square: number): string {
    return squareName(square);
  }

  private reducedMotion(): boolean {
    return typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  private freshPieces(board: BoardArray): PieceState[] {
    const pieces: PieceState[] = [];
    for (let square = 0; square < board.length; square++) {
      const cell = board[square];
      if (cell === 0) continue;
      pieces.push({
        id: `p${square}`,
        square,
        color: cell > 0 ? 'light' : 'dark',
        king: Math.abs(cell) === 2,
        captured: false,
      });
    }
    return pieces;
  }

  /**
   * Reconciles the tracked piece list against a new board snapshot. A 'move' update replays
   * `move`'s path hop by hop (sliding the mover and fading out each captured piece as it's
   * passed, since every hop's landing square is in a straight diagonal line through the
   * captured square — a plain position transition already reads as "jumping over it"). A
   * 'reset' (new game / undo) snaps straight to the new board with no animation.
   *
   * A move can arrive while the previous one is still sliding (the computer's reply comes
   * after ~200ms, a multi-jump takes 210ms per hop). The interrupted animation is cancelled
   * mid-path, so first snap the pieces to the board it was heading for — otherwise the piece
   * is left drawn on an intermediate square and the pieces it hadn't reached yet stay drawn.
   */
  private async reconcile(board: BoardArray, kind: 'reset' | 'move', move: Move | null): Promise<void> {
    const token = ++this.animationToken;
    const interrupted = this.animating ? this.targetBoard : null;
    this.animating = false;
    this.targetBoard = board;

    if (kind !== 'move' || !move || this.reducedMotion()) {
      this.pieceStates.set(this.freshPieces(board));
      return;
    }

    if (interrupted) {
      this.pieceStates.set(this.freshPieces(interrupted));
    }

    const moverId = this.pieceStates().find((p) => p.square === move.from && !p.captured)?.id;
    if (!moverId) {
      // Nothing to animate from (e.g. first render raced with a move) — just snap.
      this.pieceStates.set(this.freshPieces(board));
      return;
    }

    this.animating = true;
    const isCapture = move.captures.length > 0;
    const hopDuration = isCapture ? CAPTURE_HOP_MS : MOVE_HOP_MS;

    for (let i = 1; i < move.path.length; i++) {
      if (token !== this.animationToken) return;
      const to = move.path[i];
      const capturedSquare = isCapture ? move.captures[i - 1] : null;

      this.pieceStates.update((list) =>
        list.map((p) => {
          if (p.id === moverId) return { ...p, square: to };
          if (capturedSquare !== null && p.square === capturedSquare) return { ...p, captured: true };
          return p;
        }),
      );

      if (capturedSquare !== null) {
        // Let the captured piece's fade-out finish on its own clock, in step with the hop
        // that passes over it, without holding up the next hop of a multi-jump.
        const sq = capturedSquare;
        void delay(hopDuration).then(() => {
          if (token !== this.animationToken) return;
          this.pieceStates.update((list) => list.filter((p) => !(p.square === sq && p.captured)));
        });
      }

      await delay(hopDuration);
      if (token !== this.animationToken) return;
    }

    if (move.promotes) {
      this.pieceStates.update((list) => list.map((p) => (p.id === moverId ? { ...p, king: true } : p)));
    }
    this.animating = false;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
