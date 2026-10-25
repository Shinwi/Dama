import { ChangeDetectionStrategy, Component, input, signal } from '@angular/core';
import { OnlineStatus } from '../game/game.service';

/**
 * The online room's code, for the player to pass on to a friend (or a link that fills it
 * in), and the latest problem the server reported. Presentational: GameService owns the room.
 */
@Component({
  selector: 'app-room-panel',
  templateUrl: './room-panel.html',
  styleUrl: './room-panel.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { role: 'region', 'aria-label': 'Online room' },
})
export class RoomPanel {
  readonly status = input.required<OnlineStatus>();
  protected readonly copied = signal(false);

  /** A link that opens the game on "Join room" with the code filled in. */
  protected inviteLink(code: string): string {
    return `${location.origin}${location.pathname}?room=${code}`;
  }

  /** Phones (and some desktops) can hand the invite to WhatsApp, SMS, … through the share sheet. */
  protected readonly canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  /** The share sheet where there is one; otherwise the link goes on the clipboard. */
  async shareInvite(): Promise<void> {
    const code = this.status().code;
    const url = this.inviteLink(code);
    if (this.canShare) {
      try {
        await navigator.share({ title: 'Dama', text: `Play dama with me! Room ${code}:`, url });
        return;
      } catch (error) {
        // Closing the share sheet isn't a failure; anything else falls back to copying.
        if (error instanceof DOMException && error.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    } catch {
      // No clipboard (e.g. plain http on a phone): the code is on screen to read out instead.
    }
  }
}
