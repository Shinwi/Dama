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
        @if (last && more()) {
          <span class="more" aria-hidden="true">+</span>
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

    /* More pieces than the stacks shown can hold. */
    .more {
      font-size: calc(var(--chip-height, 11px) * 1.6);
      font-weight: 800;
      line-height: 0.8;
      color: var(--color-text-muted);
    }

    .chip.light {
      background: linear-gradient(180deg, var(--piece-white-shine) 0%, var(--piece-white-fill) 45%, #c9c5bb 100%);
      border-color: var(--piece-white-edge);
      box-shadow: 0 1px 1px rgba(0, 0, 0, 0.18);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { role: 'img', '[attr.aria-label]': 'label()', '[attr.data-count]': 'count()' },
})
export class CapturedStacks {
  readonly color = input.required<'light' | 'dark'>();
  readonly count = input.required<number>();
  /** At most this many stacks; if there are more pieces than they hold, the last gets a "+". */
  readonly maxStacks = input<number | null>(null);

  /** There are more pieces than the stacks shown. */
  protected readonly more = computed(() => {
    const max = this.maxStacks();
    return max !== null && this.count() > max * STACK_HEIGHT;
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
