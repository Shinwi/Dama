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

  async copyInvite(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.inviteLink(this.status().code));
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    } catch {
      // No clipboard (e.g. plain http on a phone): the code is on screen to read out instead.
    }
  }
}
