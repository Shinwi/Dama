import { ChangeDetectionStrategy, Component, input, linkedSignal, output } from '@angular/core';
import { Difficulty } from '../../engine/ai';
import { DARK, LIGHT, Side } from '../../engine/types';
import { BoardTheme, GameMode, Settings } from '../game/game-controller';

export type GameSetup = Pick<Settings, 'mode' | 'difficulty' | 'playerSide' | 'boardTheme'>;

interface ThemeOption {
  id: BoardTheme;
  label: string;
}

/**
 * The start screen: pick the opponent, the difficulty and colour (vs computer), and the
 * board pattern, then start. Presentational like Board: it starts from `settings` and hands
 * the choices back through `start`; App starts the game.
 */
@Component({
  selector: 'app-home',
  templateUrl: './home.html',
  styleUrl: './home.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Home {
  readonly settings = input.required<Settings>();
  readonly start = output<GameSetup>();

  protected readonly LIGHT = LIGHT;
  protected readonly DARK = DARK;

  protected readonly themes: ThemeOption[] = [
    { id: 'classic', label: 'Classic' },
    { id: 'wood', label: 'Wood' },
    { id: 'green', label: 'Green' },
  ];

  protected readonly mode = linkedSignal<GameMode>(() => this.settings().mode);
  protected readonly difficulty = linkedSignal<Difficulty>(() => this.settings().difficulty);
  protected readonly playerSide = linkedSignal<Side>(() => this.settings().playerSide);
  protected readonly boardTheme = linkedSignal<BoardTheme>(() => this.settings().boardTheme);

  /** The 4×4 corner of the board drawn in each pattern's swatch. */
  protected readonly swatchSquares = Array.from({ length: 16 }, (_, i) => (Math.floor(i / 4) + i) % 2 === 1);

  startGame(): void {
    this.start.emit({
      mode: this.mode(),
      difficulty: this.difficulty(),
      playerSide: this.playerSide(),
      boardTheme: this.boardTheme(),
    });
  }
}
