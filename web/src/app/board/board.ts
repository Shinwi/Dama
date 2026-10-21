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
  /** Picked up off the board while it moves: drawn slightly larger, with a deeper shadow. */
  lifted?: boolean;
  /** How long this piece's slide to its next square takes, while it's the one moving. */
  hopMs?: number;
}

interface PieceView extends PieceState {
  top: number;
  left: number;
}

const FILES = 'abcdefghij';

const MOVE_HOP_MS = 170;
const CAPTURE_HOP_MS = 210;
/** How long a jumped piece takes to fade out, starting as the mover passes over it. */
const CAPTURE_FADE_MS = 210;

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
  /** Pieces already jumped by the multi-jump in progress (one per hop of `pathSoFar`). */
  readonly capturedSoFar = input<number[]>([]);
  readonly landingDots = input<number[]>([]);
  readonly captureRings = input<number[]>([]);
  readonly compulsoryRings = input<number[]>([]);
  readonly lastMove = input<Move | null>(null);
  /** 'move' animates `lastMove` hop by hop; 'reset' (new game / undo) snaps instantly. */
  readonly updateKind = input<'reset' | 'move'>('reset');

  readonly squareTap = output<number>();
  /**
   * A move has finished playing out and the pieces are on their real squares. The game
   * waits for this before the other side (the computer, or the other player) can move.
   */
  readonly settled = output<void>();

  private readonly pieceStates = signal<PieceState[]>([]);
  /** Bumped by every snap (new game / undo): animations queued before it are dropped. */
  private generation = 0;
  /** Moves play one after another: each animation waits for the one before it. */
  private queue: Promise<void> = Promise.resolve();
  /** Animations queued or playing. While any are, taps are held back (see `tap()`). */
  private pending = 0;
  private heldTaps: number[] = [];
  /** The last in-progress multi-jump path drawn, so its move's slide can pick up from there. */
  private shownPath: number[] = [];

  /** Rank numbers down the left of the board, top to bottom as drawn. */
  readonly rankLabels = computed(() => {
    const ranks = Array.from({ length: 10 }, (_, i) => String(10 - i));
    return this.flipped() ? ranks.reverse() : ranks;
  });

  /** File letters along the bottom of the board, left to right as drawn. */
  readonly fileLabels = computed(() => {
    const files = FILES.split('');
    return this.flipped() ? files.reverse() : files;
  });

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

  /**
   * The tracked pieces, plus a multi-jump in progress: until the last hop is tapped nothing
   * has been played, but the moving piece is drawn on the square it has reached and the
   * pieces it has jumped fade out, so each tap visibly does something.
   */
  readonly pieces = computed<PieceView[]>(() => {
    const flipped = this.flipped();
    const path = this.pathSoFar();
    const jumping = path.length > 1;
    const captured = new Set(this.capturedSoFar());
    return this.pieceStates().map((state) => {
      let piece = state;
      if (jumping && piece.square === path[0] && !piece.captured) {
        piece = { ...piece, square: path[path.length - 1] };
      } else if (jumping && captured.has(piece.square)) {
        piece = { ...piece, captured: true };
      }
      const row = rowOf(piece.square);
      const col = colOf(piece.square);
      const visualRow = flipped ? row : 9 - row;
      const visualCol = flipped ? 9 - col : col;
      return { ...piece, top: visualRow * 10, left: visualCol * 10 };
    });
  });

  constructor() {
    effect(() => {
      const path = this.pathSoFar();
      // Not cleared when the selection empties: that's also what happens when the move is
      // committed, and reconcile() needs the path then. A fresh selection clears it instead.
      if (path.length > 1) this.shownPath = path;
      else if (path.length === 1) this.shownPath = [];
    });
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

  /**
   * Taps made while a move is still playing out are held back and delivered once it has
   * finished, so nothing gets picked up or captured on a board that hasn't caught up yet.
   */
  tap(cell: CellView): void {
    if (!cell.playable) return;
    if (this.pending > 0) {
      this.heldTaps.push(cell.square);
      return;
    }
    this.squareTap.emit(cell.square);
  }

  private releaseHeldTaps(): void {
    const taps = this.heldTaps;
    this.heldTaps = [];
    for (const square of taps) this.squareTap.emit(square);
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
   * `move`'s path hop by hop: the mover is picked up, slides from square to square, and each
   * captured piece fades out as the mover passes over it. A 'reset' (new game / undo) snaps
   * straight to the new board with no animation.
   *
   * Moves never cut each other short: one that arrives while another is still playing waits
   * its turn in `queue`. (GameService already holds the next move back until `settled`.)
   */
  private reconcile(board: BoardArray, kind: 'reset' | 'move', move: Move | null): void {
    const shownPath = this.shownPath;
    this.shownPath = [];

    if (kind !== 'move' || !move || this.reducedMotion()) {
      this.generation++;
      this.queue = Promise.resolve();
      this.pending = 0;
      this.pieceStates.set(this.freshPieces(board));
      this.releaseHeldTaps();
      if (kind === 'move' && move) this.settled.emit();
      return;
    }

    const generation = this.generation;
    this.pending++;
    this.queue = this.queue
      .then(() => (generation === this.generation ? this.animate(board, move, shownPath, generation) : undefined))
      .finally(() => {
        if (generation !== this.generation) return;
        this.pending--;
        if (this.pending === 0) {
          this.settled.emit();
          this.releaseHeldTaps();
        }
      });
  }

  private async animate(board: BoardArray, move: Move, shownPath: number[], generation: number): Promise<void> {
    const stale = () => generation !== this.generation;
    const moverId = this.pieceStates().find((p) => p.square === move.from && !p.captured)?.id;
    if (!moverId) {
      // Nothing to animate from (e.g. first render raced with a move) — just snap.
      this.pieceStates.set(this.freshPieces(board));
      return;
    }

    const isCapture = move.captures.length > 0;
    const hopMs = isCapture ? CAPTURE_HOP_MS : MOVE_HOP_MS;

    // Hops already drawn while the multi-jump was being tapped out: start from there rather
    // than sliding the piece back to where it started.
    const continuesShown = shownPath.length > 1 && shownPath.every((sq, i) => move.path[i] === sq);
    const hopsShown = continuesShown ? shownPath.length - 1 : 0;
    const jumpedAlready = new Set(move.captures.slice(0, hopsShown));
    this.pieceStates.update((list) =>
      list
        .filter((p) => p.id === moverId || !jumpedAlready.has(p.square))
        .map((p) => (p.id === moverId ? { ...p, square: move.path[hopsShown], lifted: true, hopMs } : p)),
    );

    for (let i = hopsShown + 1; i < move.path.length; i++) {
      const to = move.path[i];
      this.pieceStates.update((list) => list.map((p) => (p.id === moverId ? { ...p, square: to } : p)));

      if (isCapture) {
        // The jumped piece starts fading as the mover passes over it, halfway through the hop.
        const jumped = move.captures[i - 1];
        void delay(hopMs / 2).then(() => {
          if (stale()) return;
          this.pieceStates.update((list) =>
            list.map((p) => (p.square === jumped && p.id !== moverId ? { ...p, captured: true } : p)),
          );
        });
        void delay(hopMs / 2 + CAPTURE_FADE_MS).then(() => {
          if (stale()) return;
          this.pieceStates.update((list) => list.filter((p) => !(p.square === jumped && p.captured)));
        });
      }

      await delay(hopMs);
      if (stale()) return;
    }

    this.pieceStates.update((list) =>
      list.map((p) => (p.id === moverId ? { ...p, lifted: false, hopMs: undefined, king: p.king || move.promotes } : p)),
    );

    // Whatever happened along the way, end up showing exactly the real board.
    const shown = this.pieceStates()
      .filter((p) => !p.captured)
      .map((p) => `${p.square}:${p.color}:${p.king}`)
      .sort()
      .join();
    const real = this.freshPieces(board)
      .map((p) => `${p.square}:${p.color}:${p.king}`)
      .sort()
      .join();
    if (shown !== real) this.pieceStates.set(this.freshPieces(board));
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
