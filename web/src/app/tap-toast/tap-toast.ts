import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * The few words that go with a refused tap ("That piece can't go there."), over the top of
 * the board so nothing below it moves. Always in the page, as a live region, so screen
 * readers say the message when it appears.
 */
@Component({
  selector: 'app-tap-toast',
  template: `<p class="toast" [class.shown]="!!message()" data-testid="tap-feedback" aria-live="polite">{{ message() ?? '' }}</p>`,
  styles: `
    :host {
      position: absolute;
      inset: 8px 0 auto var(--coord-gutter, 0);
      display: flex;
      justify-content: center;
      pointer-events: none;
      z-index: 3;
    }

    .toast {
      margin: 0;
      max-width: 90%;
      padding: 8px 14px;
      border-radius: 999px;
      background: rgba(20, 20, 20, 0.86);
      color: #fff;
      font-size: 0.92rem;
      font-weight: 600;
      text-align: center;
      opacity: 0;
      transform: translateY(-4px);
      transition:
        opacity 140ms ease,
        transform 140ms ease;
    }

    .toast.shown {
      opacity: 1;
      transform: none;
    }

    @media (prefers-reduced-motion: reduce) {
      .toast {
        transition: none;
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TapToast {
  readonly message = input<string | null>(null);
}
