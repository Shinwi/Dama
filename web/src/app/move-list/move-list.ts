import { ChangeDetectionStrategy, Component, ElementRef, afterRenderEffect, computed, input, signal, viewChild } from '@angular/core';
import { squareName } from '../../engine/board';
import { moveNotation } from '../../engine/moves';
import { Ply } from '../game/game-controller';

interface Row {
  number: number;
  light: string | null;
  dark: string | null;
  lightCapture: boolean;
  darkCapture: boolean;
}

/**
 * The moves played so far, numbered in White/Black pairs, with each column headed by who
 * plays it. On a phone it folds into one line under the board (the latest pair) that opens
 * the whole list; on wider screens the list is always open. Presentational.
 */
@Component({
  selector: 'app-move-list',
  templateUrl: './move-list.html',
  styleUrl: './move-list.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-testid': 'move-list', role: 'region', 'aria-label': 'Moves', '[class.open]': 'open()' },
})
export class MoveList {
  readonly plies = input.required<readonly Ply[]>();
  /** Who plays White and Black: "You", "Opponent", "Computer", or the colours in 1v1. */
  readonly names = input.required<{ light: string; dark: string }>();
  /** E.g. "30s per move", shown in the header. */
  readonly note = input<string | null>(null);

  protected readonly open = signal(false);
  private readonly scroller = viewChild<ElementRef<HTMLElement>>('scroller');

  protected readonly rows = computed<Row[]>(() => {
    const plies = this.plies();
    const rows: Row[] = [];
    for (let i = 0; i < plies.length; i += 2) {
      const [light, dark] = [plies[i], plies[i + 1]];
      rows.push({
        number: i / 2 + 1,
        light: light ? plyNotation(light) : null,
        dark: dark ? plyNotation(dark) : null,
        lightCapture: !!light?.move?.captures.length,
        darkCapture: !!dark?.move?.captures.length,
      });
    }
    return rows;
  });

  /** The folded line: the latest pair of moves. */
  protected readonly summary = computed(() => {
    const last = this.rows().at(-1);
    if (!last) return 'No moves yet';
    const names = this.names();
    const dark = last.dark ? ` · ${names.dark} ${last.dark}` : '';
    return `${last.number}. ${names.light} ${last.light}${dark}`;
  });

  constructor() {
    // Keep the latest move in view.
    afterRenderEffect(() => {
      this.rows();
      this.open();
      const el = this.scroller()?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }

  toggle(): void {
    this.open.update((open) => !open);
  }
}

/** "c3-d4", "c3xe5xg7", "nfikh d6, a3-b4", or "out of time" for a skipped turn. */
export function plyNotation(ply: Ply): string {
  const nfikh = ply.nfikh === null ? '' : `nfikh ${squareName(ply.nfikh)}, `;
  return nfikh + (ply.move ? moveNotation(ply.move) : 'out of time');
}
