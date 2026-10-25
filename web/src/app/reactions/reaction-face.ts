import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { ReactionId } from '../../protocol/online';

/** A reaction face, drawn in the current text colour (`currentColor`), at `size` px. */
@Component({
  selector: 'app-reaction-face',
  template: `
    <svg aria-hidden="true" [attr.width]="size()" [attr.height]="size()" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="9"></circle>
      @switch (face()) {
        @case ('laugh') {
          <path d="M7.5 9.5l2-1-2-1M16.5 9.5l-2-1 2-1"></path>
          <path d="M7.5 13h9c-.5 2.6-2.4 4-4.5 4s-4-1.4-4.5-4z"></path>
        }
        @case ('wow') {
          <path d="M9 9.5h.01M15 9.5h.01"></path>
          <circle cx="12" cy="15.5" r="2"></circle>
        }
        @case ('oops') {
          <path d="M8.5 16h7M8.5 9.5l1.5 1M15.5 9.5l-1.5 1"></path>
        }
        @case ('grumpy') {
          <path d="M7.5 8l3 1.5M16.5 8l-3 1.5M9 16.5c1-1.2 2-1.7 3-1.7s2 .5 3 1.7"></path>
        }
        @case ('cheeky') {
          <path d="M7.5 10h3M15 9.5h.01M8.5 14c2 1.6 5 1.6 7 0"></path>
          <path d="M12 15v2a1.6 1.6 0 0 0 3.2 0v-2"></path>
        }
        @case ('thinking') {
          <path d="M9 15.5h6M9 9.5h.01M15 9.5h.01M14 6.5l2 1"></path>
        }
        @default {
          <path d="M8.5 14.5c1 1.3 2.2 2 3.5 2s2.5-.7 3.5-2M9 9.5h.01M15 9.5h.01"></path>
        }
      }
    </svg>
  `,
  styles: `
    :host {
      display: inline-grid;
      place-items: center;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReactionFace {
  readonly face = input.required<ReactionId>();
  readonly size = input(24);
}
