import { ChangeDetectionStrategy, Component, ElementRef, inject, input, output, signal } from '@angular/core';
import { OnlineStatus } from '../game/game.service';
import { canShare, copyText, shareInvite } from './invite';

/**
 * The room, once both players are in: a small chip with its code (and a dot for whether the
 * opponent is connected) that opens a menu: share the invite, copy the code, leave.
 */
@Component({
  selector: 'app-room-chip',
  template: `
    <button
      type="button"
      class="chip"
      data-testid="room-chip"
      aria-haspopup="menu"
      [attr.aria-expanded]="open()"
      (click)="open.set(!open())"
    >
      <span class="dot" [class.gone]="!status().opponentConnected" aria-hidden="true"></span>
      Room <span class="code" data-testid="room-code">{{ status().code }}</span>
      <span class="more" aria-hidden="true">▾</span>
    </button>
    @if (open()) {
      <div class="menu" role="menu">
        <button type="button" role="menuitem" (click)="share()">{{ shareLabel() }}</button>
        <button type="button" role="menuitem" (click)="copyCode()">{{ copied() === 'code' ? 'Code copied' : 'Copy room code' }}</button>
        <button type="button" role="menuitem" class="danger" (click)="leaveRoom()">Leave room</button>
      </div>
    }
  `,
  styles: `
    :host {
      position: relative;
      display: inline-block;
    }

    .chip {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 7px 12px;
      border-radius: 999px;
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      color: var(--color-text);
      font-size: 0.88rem;
      font-weight: 600;
      cursor: pointer;
    }

    .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #2fa564;
    }

    .dot.gone {
      background: #c0392b;
    }

    .code {
      font-family: var(--font-title);
      letter-spacing: 0.12em;
      color: var(--color-accent);
    }

    .more {
      color: var(--color-text-muted);
    }

    .menu {
      position: absolute;
      right: 0;
      top: calc(100% + 6px);
      z-index: 20;
      min-width: 190px;
      display: flex;
      flex-direction: column;
      padding: 6px;
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: 12px;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.15);
    }

    .menu button {
      padding: 9px 12px;
      border: none;
      border-radius: 8px;
      background: none;
      color: var(--color-text);
      font-size: 0.92rem;
      text-align: left;
      cursor: pointer;
    }

    .menu button:hover,
    .menu button:focus-visible {
      background: color-mix(in srgb, var(--color-accent) 10%, transparent);
    }

    .menu .danger {
      color: #c0392b;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:click)': 'closeOutside($event)', '(keydown.escape)': 'open.set(false)' },
})
export class RoomChip {
  readonly status = input.required<OnlineStatus>();
  readonly leave = output<void>();

  protected readonly open = signal(false);
  protected readonly copied = signal<'link' | 'code' | null>(null);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected shareLabel(): string {
    if (this.copied() === 'link') return 'Link copied';
    return canShare() ? 'Share invite' : 'Copy invite link';
  }

  async share(): Promise<void> {
    if ((await shareInvite(this.status().code)) === 'copied') this.flash('link');
  }

  async copyCode(): Promise<void> {
    if ((await copyText(this.status().code)) === 'copied') this.flash('code');
  }

  leaveRoom(): void {
    this.open.set(false);
    this.leave.emit();
  }

  closeOutside(event: Event): void {
    if (!this.host.nativeElement.contains(event.target as Node)) this.open.set(false);
  }

  private flash(what: 'link' | 'code'): void {
    this.copied.set(what);
    setTimeout(() => {
      this.copied.set(null);
      this.open.set(false);
    }, 1200);
  }
}
