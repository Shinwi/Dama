import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { Board } from '../board/board';
import { parseSquare } from '../../engine/board';
import { BoardArray, DARK, LIGHT, Move, Side } from '../../engine/types';
import { DamaScene, Markers, Mood } from './dama-scene';

const STORAGE_KEY = 'dama.3d.v1';

declare global {
  interface Window {
    /** Testability hook for e2e tests: where a square (e.g. "b4") is on screen, to click it. */
    dama3d?: { project(square: string): { x: number; y: number } };
  }
}

function loadTurnTable(): boolean {
  try {
    return (JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as { turnTable?: boolean }).turnTable ?? false;
  } catch {
    return false;
  }
}

function saveTurnTable(turnTable: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ turnTable }));
  } catch {
    // Private browsing / quota exceeded — the setting just won't persist.
  }
}

/**
 * The 3D board: the same inputs and outputs as `Board`, drawn with Three.js by `DamaScene`.
 *
 * For keyboard and screen-reader play (and Playwright), a visually hidden `Board` sits
 * underneath with the real square buttons and pieces: it takes the arrow keys and Enter, and
 * the square it has focused is outlined in 3D. It always snaps (updateKind 'reset'), so it
 * never animates or reports `settled` itself: this component does that, once the 3D move
 * has played out.
 *
 * Without WebGL, it shows the ordinary 2D board instead.
 */
@Component({
  selector: 'app-board-3d',
  imports: [Board],
  templateUrl: './board3d.html',
  styleUrl: './board3d.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.fill]': 'fullscreen()' },
})
export class Board3d {
  readonly board = input.required<BoardArray>();
  readonly flipped = input(false);
  readonly selected = input<number | null>(null);
  readonly pathSoFar = input<number[]>([]);
  readonly capturedSoFar = input<number[]>([]);
  readonly landingDots = input<number[]>([]);
  readonly captureRings = input<number[]>([]);
  readonly compulsoryRings = input<number[]>([]);
  readonly lastMove = input<Move | null>(null);
  readonly updateKind = input<'reset' | 'move'>('reset');
  /** Whose turn it is, for "Turn the table". */
  readonly turnSide = input<Side>(LIGHT);
  /** 1v1 on one device: "Turn the table" is offered. */
  readonly pvp = input(false);
  readonly mood = input<Mood>(null);
  /** Shown full screen: the board fills its container instead of being a square. */
  readonly fullscreen = input(false);

  readonly squareTap = output<number>();
  readonly settled = output<void>();
  /** The full-screen button: the app decides what goes full screen (the board and its status line). */
  readonly fullscreenToggle = output<void>();

  readonly unavailable = signal(false);
  readonly turnTable = signal(loadTurnTable());

  private readonly stage = viewChild<ElementRef<HTMLElement>>('stage');
  private scene: DamaScene | null = null;
  private seen: { board: BoardArray | null; kind: string | null; move: Move | null } = { board: null, kind: null, move: null };
  private generation = 0;
  private queue: Promise<void> = Promise.resolve();
  /** Moves queued or playing. While any are, taps are held back, as `Board` does. */
  private pending = 0;
  private heldTaps: number[] = [];

  /** Which side of the table the camera looks from. */
  private readonly viewSide = computed<Side>(() =>
    this.pvp() && this.turnTable() ? this.turnSide() : this.flipped() ? DARK : LIGHT,
  );

  private readonly markers = computed<Markers>(() => ({
    selected: this.selected(),
    path: this.pathSoFar(),
    dots: this.landingDots(),
    rings: this.captureRings(),
    compulsory: this.compulsoryRings(),
    lastMove: this.lastMove()?.path ?? [],
  }));

  constructor() {
    afterNextRender(() => this.start());
    inject(DestroyRef).onDestroy(() => {
      this.scene?.dispose();
      this.scene = null;
      delete window.dama3d;
    });

    effect(() => {
      const board = this.board();
      const kind = this.updateKind();
      const move = this.lastMove();
      const path = this.pathSoFar();
      const captured = this.capturedSoFar();
      untracked(() => this.sync(board, kind, move, path, captured));
    });
    effect(() => {
      const markers = this.markers();
      untracked(() => this.scene?.setMarkers(markers));
    });
    effect(() => {
      const side = this.viewSide();
      // In 1v1 with "Turn the table", the turn passes as soon as the move is made: the
      // camera waits for it to finish playing out (see sync()).
      untracked(() => this.pending === 0 && this.scene?.setViewSide(side));
    });
    effect(() => {
      const mood = this.mood();
      untracked(() => this.scene?.setMood(mood));
    });
  }

  private start(): void {
    const stage = this.stage()?.nativeElement;
    if (!stage) return;
    try {
      this.scene = new DamaScene(stage, (square) => this.tap(square));
    } catch {
      this.unavailable.set(true);
      return;
    }
    const scene = this.scene;
    scene.snap(this.board());
    scene.setMarkers(this.markers());
    scene.setViewSide(this.viewSide(), false);
    scene.setMood(this.mood());
    scene.intro();
    this.seen = { board: this.board(), kind: this.updateKind(), move: this.lastMove() };
    // Switched to 3D while a move was playing out on the 2D board: it has landed now.
    if (this.updateKind() === 'move') this.settled.emit();
    window.dama3d = { project: (square) => scene.project(parseSquare(square)) };
  }

  private sync(board: BoardArray, kind: 'reset' | 'move', move: Move | null, path: number[], captured: number[]): void {
    const scene = this.scene;
    if (!scene) return;
    const changed = board !== this.seen.board || kind !== this.seen.kind || move !== this.seen.move;
    this.seen = { board, kind, move };
    if (!changed) {
      scene.showPartial(path, captured);
      return;
    }

    if (kind !== 'move' || !move) {
      this.generation++;
      this.queue = Promise.resolve();
      this.pending = 0;
      scene.snap(board);
      scene.setViewSide(this.viewSide());
      this.releaseHeldTaps();
      return;
    }

    const generation = this.generation;
    this.pending++;
    this.queue = this.queue
      .then(() => (generation === this.generation ? scene.playMove(move, board) : undefined))
      .finally(() => {
        if (generation !== this.generation) return;
        this.pending--;
        if (this.pending === 0) {
          this.settled.emit();
          scene.setViewSide(this.viewSide());
          this.releaseHeldTaps();
        }
      });
  }

  tap(square: number): void {
    if (this.pending > 0) {
      this.heldTaps.push(square);
      return;
    }
    this.squareTap.emit(square);
  }

  private releaseHeldTaps(): void {
    const taps = this.heldTaps;
    this.heldTaps = [];
    for (const square of taps) this.squareTap.emit(square);
  }

  /** The hidden square buttons have keyboard focus: outline that square on the 3D board. */
  onFocusIn(event: FocusEvent): void {
    const name = (event.target as HTMLElement | null)?.closest('button[data-square]')?.getAttribute('data-square');
    this.scene?.setFocus(name ? parseSquare(name) : null);
  }

  onFocusOut(): void {
    this.scene?.setFocus(null);
  }

  resetView(): void {
    this.scene?.resetView();
  }

  toggleTurnTable(): void {
    this.turnTable.update((on) => !on);
    saveTurnTable(this.turnTable());
  }
}
