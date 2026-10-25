import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { CapturedStacks } from './captured-stacks';

/**
 * Beside the board on wide screens: the pieces one player has captured, stacked, with a
 * label and the count. `at`: which end the stacks sit at, near that player's side of the board.
 */
@Component({
  selector: 'app-captured-tray',
  imports: [CapturedStacks],
  template: `
    <span class="label">{{ name() }} took</span>
    <app-captured-stacks [color]="color()" [count]="count()"></app-captured-stacks>
    <span class="count">{{ count() }}</span>
  `,
  styles: `
    :host {
      display: none;
      width: 100px;
      flex: none;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      padding: 10px 6px;
      border: 1px dashed var(--color-border);
      border-radius: 12px;
      --chip-width: 34px;
      --chip-height: 12px;
      --stack-gap: 8px 6px;
    }

    :host(.bottom) {
      justify-content: flex-end;
    }

    app-captured-stacks {
      justify-content: center;
    }

    .label {
      font-size: 0.6rem;
      font-weight: 800;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--color-text-muted);
      text-align: center;
    }

    .count {
      font-family: var(--font-title);
      font-size: 1.4rem;
      line-height: 1;
    }

    @media (min-width: 1000px) {
      :host {
        display: flex;
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.bottom]': "at() === 'bottom'" },
})
export class CapturedTray {
  readonly name = input.required<string>();
  /** The colour of the pieces captured. */
  readonly color = input.required<'light' | 'dark'>();
  readonly count = input.required<number>();
  readonly at = input<'top' | 'bottom'>('top');
}
