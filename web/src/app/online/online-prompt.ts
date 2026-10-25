import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

/**
 * A question for the player during an online game, with two answers: "Your opponent offers
 * a draw. Accept / Decline", "Your opponent has been gone for 5 minutes. Claim win / Keep
 * waiting". Shown above the board, where it can't be missed.
 */
@Component({
  selector: 'app-online-prompt',
  template: `
    <p class="text">{{ text() }}</p>
    <div class="buttons">
      <button type="button" (click)="yes.emit()">{{ yesLabel() }}</button>
      <button type="button" class="secondary" (click)="no.emit()">{{ noLabel() }}</button>
    </div>
  `,
  styles: `
    :host {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: center;
      gap: 8px 14px;
      padding: 10px 14px;
      border-radius: var(--radius-md);
      background: color-mix(in srgb, var(--color-saffron) 18%, var(--color-surface));
      border: 1px solid color-mix(in srgb, var(--color-saffron) 45%, transparent);
    }

    .text {
      margin: 0;
      font-weight: 600;
      text-align: center;
    }

    .buttons {
      display: flex;
      gap: 8px;
    }

    button {
      border: 1px solid var(--color-accent);
      background: var(--color-accent);
      color: var(--color-accent-contrast);
      padding: 8px 14px;
      border-radius: var(--radius-md);
      font-size: 0.9rem;
      font-weight: 600;
      cursor: pointer;
    }

    button.secondary {
      background: var(--color-surface);
      color: var(--color-text);
      border-color: var(--color-border);
    }
  `,
  host: { role: 'alert' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OnlinePrompt {
  readonly text = input.required<string>();
  readonly yesLabel = input.required<string>();
  readonly noLabel = input.required<string>();
  readonly yes = output<void>();
  readonly no = output<void>();
}
