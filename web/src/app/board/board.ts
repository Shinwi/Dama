import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { squareName } from '../../engine/board';
import { BoardArray } from '../../engine/types';

interface CellView {
  key: number;
  square: number;
  playable: boolean;
  name: string;
  value: number;
  selected: boolean;
  onPath: boolean;
  isLandingDot: boolean;
  isCaptureRing: boolean;
  isCompulsoryRing: boolean;
  isLastMove: boolean;
}

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
  readonly lastMovePath = input<number[]>([]);

  readonly squareTap = output<number>();

  readonly cells = computed<CellView[]>(() => {
    const board = this.board();
    const flipped = this.flipped();
    const selected = this.selected();
    const path = new Set(this.pathSoFar());
    const dots = new Set(this.landingDots());
    const rings = new Set(this.captureRings());
    const compulsory = new Set(this.compulsoryRings());
    const lastMove = new Set(this.lastMovePath());

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
          value: playable ? board[square] : 0,
          selected: playable && selected === square,
          onPath: playable && path.has(square),
          isLandingDot: playable && dots.has(square),
          isCaptureRing: playable && rings.has(square),
          isCompulsoryRing: playable && compulsory.has(square),
          isLastMove: playable && lastMove.has(square),
        });
      }
    }
    return result;
  });

  tap(cell: CellView): void {
    if (!cell.playable) return;
    this.squareTap.emit(cell.square);
  }
}
