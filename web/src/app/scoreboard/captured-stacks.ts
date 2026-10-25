import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/** The most pieces in one stack; more start the next stack. */
const STACK_HEIGHT = 4;

/**
 * Captured pieces, seen from the side, in stacks of up to four (7 is a stack of 4 and one
 * of 3). `color` is the colour of the pieces shown, i.e. the side they were taken from.
 */
@Component({
  selector: 'app-captured-stacks',
  template: `
    @for (stack of stacks(); track $index; let last = $last) {
      <span class="stack">
        @if (last && more() > 0) {
          <span class="more" aria-hidden="true">+{{ more() }}</span>
        }
        @for (piece of stack; track $index) {
          <span class="chip" [class.light]="color() === 'light'" [style.z-index]="10 - $index"></span>
        }
      </span>
    }
  `,
  styles: `
    :host {
      display: flex;
      align-items: flex-end;
      gap: var(--stack-gap, 4px);
      flex-wrap: wrap;
    }

    .stack {
      display: flex;
      flex-direction: column;
      align-items: center;
    }

    .chip {
      position: relative;
      width: var(--chip-width, 30px);
      height: var(--chip-height, 11px);
      border-radius: 50%;
      margin-bottom: calc(var(--chip-height, 11px) * -0.42);
      background: linear-gradient(180deg, var(--piece-black-shine) 0%, #2a2a2a 45%, #0d0d0d 100%);
      border: 1px solid var(--piece-black-edge);
      box-shadow: 0 1px 1px rgba(0, 0, 0, 0.3);
    }

    .chip:last-child {
      margin-bottom: 0;
    }

    /* The right-hand player's side: stacks fill from the middle outwards, and the "+N" sits on
       the inner corner, so it never runs off the edge of the screen. */
    :host(.mirrored) {
      flex-direction: row-reverse;
    }

    :host(.mirrored) .more {
      right: auto;
      left: -11px;
    }

    .chip.light {
      background: linear-gradient(180deg, var(--piece-white-shine) 0%, var(--piece-white-fill) 45%, #c9c5bb 100%);
      border-color: var(--piece-white-edge);
      box-shadow: 0 1px 1px rgba(0, 0, 0, 0.18);
    }

    .stack {
      position: relative;
    }

    /* More pieces than the stacks shown can hold: a gold "+N" counter on the last stack's
       top-right corner, so nothing moves. */
    .more {
      position: absolute;
      top: -6px;
      right: -11px;
      z-index: 20;
      height: 12px;
      padding: 0 3px;
      display: grid;
      place-items: center;
      border-radius: 6px;
      border: 1.5px solid #fff;
      background: linear-gradient(180deg, #f7c548, var(--color-saffron));
      color: #2b1d00;
      font-size: 8.5px;
      font-weight: 900;
      line-height: 1;
      letter-spacing: -0.02em;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.35);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.mirrored]': 'mirrored()', role: 'img', '[attr.aria-label]': 'label()', '[attr.data-count]': 'count()' },
})
export class CapturedStacks {
  readonly color = input.required<'light' | 'dark'>();
  readonly count = input.required<number>();
  /** The right-hand side of the scoreboard: mirrored, so the "+N" faces the middle. */
  readonly mirrored = input(false);
  /** At most this many stacks; if there are more pieces than they hold, the last gets "+N". */
  readonly maxStacks = input<number | null>(null);

  /** How many more pieces there are than the stacks shown hold (0 if they all show). */
  protected readonly more = computed(() => {
    const max = this.maxStacks();
    return max === null ? 0 : Math.max(0, this.count() - max * STACK_HEIGHT);
  });

  protected readonly stacks = computed(() => {
    const stacks: number[][] = [];
    const max = this.maxStacks();
    const shown = max === null ? this.count() : Math.min(this.count(), max * STACK_HEIGHT);
    for (let left = shown; left > 0; left -= STACK_HEIGHT) {
      stacks.push(Array.from({ length: Math.min(STACK_HEIGHT, left) }, (_, i) => i));
    }
    return stacks;
  });

  protected readonly label = computed(() => {
    const n = this.count();
    return `${n} ${this.color() === 'light' ? 'white' : 'black'} piece${n === 1 ? '' : 's'} captured`;
  });
}
