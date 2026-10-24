import { ChangeDetectionStrategy, Component, computed, input, linkedSignal, output } from '@angular/core';
import { Difficulty } from '../../engine/ai';
import { DARK, LIGHT, Side } from '../../engine/types';
import { BoardTheme, GameMode, Settings } from '../game/game-controller';
import { OnlineEntry } from '../game/game.service';

export type GameSetup = Pick<Settings, 'mode' | 'difficulty' | 'playerSide' | 'boardTheme'> & {
  /** Set when mode is 'online': make a new room, or join a friend's. */
  online?: OnlineEntry;
};

interface ThemeOption {
  id: BoardTheme;
  label: string;
}

/**
 * The start screen: pick the opponent, the difficulty and colour (vs computer), or a room
 * to create or join (online), and the board pattern, then start. Presentational like Board:
 * it starts from `settings` and hands the choices back through `start`; App starts the game.
 */
@Component({
  selector: 'app-home',
  templateUrl: './home.html',
  styleUrl: './home.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Home {
  readonly settings = input.required<Settings>();
  /** A room code from an invite link (`?room=K7QX`): opens on "Join room" with it filled in. */
  readonly inviteCode = input<string | null>(null);
  /** Connecting to the online server: the start button waits. */
  readonly busy = input(false);
  /** Why the last attempt to get into a room failed. */
  readonly error = input<string | null>(null);
  readonly start = output<GameSetup>();

  protected readonly LIGHT = LIGHT;
  protected readonly DARK = DARK;

  protected readonly themes: ThemeOption[] = [
    { id: 'classic', label: 'Classic' },
    { id: 'wood', label: 'Wood' },
    { id: 'green', label: 'Green' },
  ];

  protected readonly mode = linkedSignal<GameMode>(() => (this.inviteCode() ? 'online' : this.settings().mode));
  protected readonly onlineEntry = linkedSignal<'create' | 'join'>(() => (this.inviteCode() ? 'join' : 'create'));
  protected readonly roomCode = linkedSignal(() => this.inviteCode() ?? '');
  protected readonly difficulty = linkedSignal<Difficulty>(() => this.settings().difficulty);
  protected readonly playerSide = linkedSignal<Side>(() => this.settings().playerSide);
  protected readonly boardTheme = linkedSignal<BoardTheme>(() => this.settings().boardTheme);

  /** The 4×4 corner of the board drawn in each pattern's swatch. */
  protected readonly swatchSquares = Array.from({ length: 16 }, (_, i) => (Math.floor(i / 4) + i) % 2 === 1);

  protected readonly startLabel = computed(() => {
    if (this.busy()) return 'Connecting…';
    if (this.mode() !== 'online') return 'Start game';
    return this.onlineEntry() === 'create' ? 'Create room' : 'Join room';
  });

  protected readonly canStart = computed(
    () => !this.busy() && !(this.mode() === 'online' && this.onlineEntry() === 'join' && this.roomCode().trim().length === 0),
  );

  setRoomCode(event: Event): void {
    this.roomCode.set((event.target as HTMLInputElement).value.toUpperCase());
  }

  startGame(): void {
    if (!this.canStart()) return;
    const online: OnlineEntry | undefined =
      this.mode() !== 'online'
        ? undefined
        : this.onlineEntry() === 'create'
          ? { kind: 'create' }
          : { kind: 'join', code: this.roomCode().trim() };
    this.start.emit({
      mode: this.mode(),
      difficulty: this.difficulty(),
      playerSide: this.playerSide(),
      boardTheme: this.boardTheme(),
      online,
    });
  }
}
