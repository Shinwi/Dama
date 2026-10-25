import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** What Damo is up to. */
export type DamoMood = 'happy' | 'search' | 'crown' | 'sad' | 'shrug';

/**
 * Damo, Souk Party's mascot: a black dama piece with googly eyes. Pure decoration (hidden
 * from screen readers); `size` in px.
 */
@Component({
  selector: 'app-damo',
  template: `
    <svg aria-hidden="true" [attr.width]="size()" [attr.height]="size()" viewBox="0 0 100 100">
      <ellipse cx="50" cy="94" rx="32" ry="5" fill="rgba(27,27,27,0.25)"></ellipse>
      @if (mood() === 'crown') {
        <path d="M30 22l8 10 12-14 12 14 8-10-4 20H34z" fill="#ffd23f" stroke="#1b1b1b" stroke-width="3" stroke-linejoin="round"></path>
      }
      <circle cx="50" cy="58" r="34" fill="#1b1b1b"></circle>
      <circle cx="50" cy="58" r="24" fill="none" stroke="#4a4a4a" stroke-width="3"></circle>
      @switch (mood()) {
        @case ('crown') {
          <path d="M36 52l6-4M58 48l6 4" stroke="#ffffff" stroke-width="3.5" stroke-linecap="round"></path>
          <path d="M37 62h26c-1 9-6 13-13 13s-12-4-13-13z" fill="#ffffff"></path>
          <path d="M44 71c2 2 4 3 6 3s4-1 6-3" fill="#ff5a4e"></path>
        }
        @case ('sad') {
          <circle cx="38" cy="52" r="9" fill="#ffffff" stroke="#1b1b1b" stroke-width="2"></circle>
          <circle cx="62" cy="52" r="9" fill="#ffffff" stroke="#1b1b1b" stroke-width="2"></circle>
          <circle cx="38" cy="56" r="4" fill="#1b1b1b"></circle>
          <circle cx="62" cy="56" r="4" fill="#1b1b1b"></circle>
          <path d="M40 74c3-4 6-5 10-5s7 1 10 5" fill="none" stroke="#ffffff" stroke-width="3.5" stroke-linecap="round"></path>
          <path d="M70 62c3 4 3 7 0 9-3-2-3-5 0-9z" fill="#3fa9f5"></path>
        }
        @case ('shrug') {
          <circle cx="38" cy="52" r="9" fill="#ffffff" stroke="#1b1b1b" stroke-width="2"></circle>
          <circle cx="62" cy="52" r="9" fill="#ffffff" stroke="#1b1b1b" stroke-width="2"></circle>
          <circle cx="40" cy="51" r="4" fill="#1b1b1b"></circle>
          <circle cx="64" cy="51" r="4" fill="#1b1b1b"></circle>
          <path d="M40 70h20" stroke="#ffffff" stroke-width="3.5" stroke-linecap="round"></path>
        }
        @default {
          <circle cx="38" cy="50" r="10" fill="#ffffff" stroke="#1b1b1b" stroke-width="2"></circle>
          <circle cx="62" cy="50" r="10" fill="#ffffff" stroke="#1b1b1b" stroke-width="2"></circle>
          <circle [attr.cx]="mood() === 'search' ? 42 : 41" cy="53" r="4.5" fill="#1b1b1b"></circle>
          <circle [attr.cx]="mood() === 'search' ? 66 : 60" cy="52" r="4.5" fill="#1b1b1b"></circle>
          <path d="M37 68c4 7 8 9 13 9s9-2 13-9" fill="#ff5a4e" stroke="#ffffff" stroke-width="3" stroke-linecap="round"></path>
          <circle cx="24" cy="64" r="5" fill="#ff8f86"></circle>
          <circle cx="76" cy="64" r="5" fill="#ff8f86"></circle>
        }
      }
      @if (mood() === 'search') {
        <path d="M80 72l14 14" stroke="#8a5a36" stroke-width="7" stroke-linecap="round"></path>
        <circle cx="74" cy="64" r="13" fill="rgba(255,255,255,0.55)" stroke="#1b1b1b" stroke-width="4"></circle>
      }
    </svg>
  `,
  styles: `
    :host {
      display: inline-block;
      line-height: 0;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Damo {
  readonly mood = input<DamoMood>('happy');
  readonly size = input(100);
}
