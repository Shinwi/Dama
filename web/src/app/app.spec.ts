import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { App, describeGameOver, describeNfikh, describeOpponentGone, describeSetup, describeTimeout, inviteCodeFrom } from './app';
import { defaultSettings } from './game/game-controller';
import { GameService } from './game/game.service';
import { boardFrom, parseSquare } from '../engine/board';
import { DARK, LIGHT } from '../engine/types';

describe('App', () => {
  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideZonelessChangeDetection()],
    }).compileComponents();
  });

  /** The app opens on the home screen: press its start button to get to the board. */
  function startedApp() {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const start = fixture.nativeElement.querySelector('[data-testid="start"]') as HTMLButtonElement;
    start.click();
    fixture.detectChanges();
    return fixture;
  }

  it('opens on the home screen, with no board yet', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('app-home')).not.toBeNull();
    expect(fixture.nativeElement.querySelectorAll('[data-testid="piece"]').length).toBe(0);
  });

  it('renders the 40 starting pieces', () => {
    const fixture = startedApp();
    const pieces = fixture.nativeElement.querySelectorAll('[data-testid="piece"]');
    expect(pieces.length).toBe(40);
  });

  it('shows "Your move." for White to move at the start', () => {
    const fixture = startedApp();
    const status = fixture.nativeElement.querySelector('[data-testid="status"]');
    expect(status.textContent).toContain('Your move.');
  });

  it('offers Undo vs the computer but not in 1v1', () => {
    const undoButton = (fixture: ReturnType<typeof TestBed.createComponent<App>>) =>
      [...fixture.nativeElement.querySelectorAll('button')].find(
        (b: HTMLButtonElement) => b.textContent?.trim() === 'Undo',
      );

    const vsComputer = startedApp();
    expect(undoButton(vsComputer)).toBeDefined();

    localStorage.setItem('dama.settings.v1', JSON.stringify({ mode: 'pvp' }));
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [App],
      providers: [provideZonelessChangeDetection()],
    });
    const pvp = startedApp();
    expect(undoButton(pvp)).toBeUndefined();
  });

  it('shows the game-over card only once the winning move has finished on the board', async () => {
    localStorage.setItem('dama.settings.v1', JSON.stringify({ mode: 'pvp' }));
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ imports: [App], providers: [provideZonelessChangeDetection()] });
    const fixture = startedApp();
    const game = TestBed.inject(GameService);
    const controller = game['controller'];
    // White c3 takes Black's last piece, d4, landing on e5.
    controller.state = { ...controller.state, board: boardFrom({ light: ['c3'], dark: ['d4'] }) };
    controller.resetSelection();
    game.tapSquare(parseSquare('c3'));
    game.tapSquare(parseSquare('e5'));
    await fixture.whenStable();

    expect(game.outcome().kind).toBe('win');
    expect(game.moving()).toBe(true); // the capture is still sliding
    expect(fixture.nativeElement.querySelector('[data-testid="game-over"]')).toBeNull();

    game.boardSettled();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('[data-testid="game-over"]')).not.toBeNull();
  });

  it('marks both kinds of move for a piece that can capture or just move', async () => {
    const fixture = startedApp();
    const game = TestBed.inject(GameService);
    const controller = game['controller'];
    // White c3 can take d4 (landing on e5) or step to b4.
    controller.state = { ...controller.state, board: boardFrom({ light: ['c3'], dark: ['d4', 'j10'] }) };
    controller.resetSelection();
    game.tapSquare(parseSquare('c3'));
    await fixture.whenStable();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('button[data-square="e5"] .capture-ring')).not.toBeNull();
    expect(el.querySelector('button[data-square="b4"] .dot')).not.toBeNull();
  });

  it('does not show the game-over overlay while a game is ongoing', () => {
    const fixture = startedApp();
    expect(fixture.nativeElement.querySelector('[data-testid="game-over"]')).toBeNull();
  });
});

describe('describeGameOver', () => {
  const settings = defaultSettings();

  it('returns null while the game is ongoing', () => {
    expect(describeGameOver({ kind: 'ongoing' }, settings)).toBeNull();
  });

  it('describes a draw', () => {
    const result = describeGameOver({ kind: 'draw' }, settings);
    expect(result?.variant).toBe('neutral');
    expect(result?.title).toBe('Draw');
  });

  it('vs computer: "You win!" when the player is the winner', () => {
    const result = describeGameOver({ kind: 'win', winner: LIGHT }, { ...settings, mode: 'computer', playerSide: LIGHT });
    expect(result?.variant).toBe('win');
    expect(result?.title).toBe('You win!');
  });

  it('vs computer: "You lose" when the computer is the winner', () => {
    const result = describeGameOver({ kind: 'win', winner: DARK }, { ...settings, mode: 'computer', playerSide: LIGHT });
    expect(result?.variant).toBe('loss');
    expect(result?.title).toBe('You lose');
  });

  it('1v1: names the winning side, no "you"', () => {
    const result = describeGameOver({ kind: 'win', winner: DARK }, { ...settings, mode: 'pvp' });
    expect(result?.variant).toBe('win');
    expect(result?.title).toBe('Black wins!');
    expect(result?.subtitle).toContain('White');
  });
});

describe('describeNfikh', () => {
  const settings = { ...defaultSettings(), mode: 'computer' as const, playerSide: LIGHT };
  const e5 = 44; // row 4, col 4

  it('says nothing when no piece was taken', () => {
    expect(describeNfikh(null, settings)).toBeNull();
  });

  it('vs computer: tells the player they missed a capture', () => {
    expect(describeNfikh({ square: e5, by: DARK }, settings)).toContain('you missed a capture');
  });

  it('vs computer: tells the player they took the piece', () => {
    expect(describeNfikh({ square: e5, by: LIGHT }, settings)).toContain('You took');
  });

  it('1v1: names the sides and the square', () => {
    expect(describeNfikh({ square: e5, by: LIGHT }, { ...settings, mode: 'pvp' })).toBe(
      "Nfikh! White took Black's piece on e5: it missed a capture.",
    );
  });
});

describe('online wording', () => {
  const online = { ...defaultSettings(), mode: 'online' as const, playerSide: DARK };

  it('talks about "your opponent", not the computer', () => {
    expect(describeNfikh({ square: 44, by: LIGHT }, online)).toBe(
      'Nfikh! Your opponent took your piece on e5: you missed a capture.',
    );
    expect(describeGameOver({ kind: 'win', winner: DARK }, online)?.subtitle).toBe('Your opponent has no legal move left.');
    expect(describeGameOver({ kind: 'win', winner: LIGHT }, online)?.title).toBe('You lose');
  });

  it('says which side you play', () => {
    expect(describeSetup(online)).toBe('Online · You play Black');
  });

  it('reads a room code from an invite link', () => {
    expect(inviteCodeFrom('?room=k7qx')).toBe('K7QX');
    expect(inviteCodeFrom('?room=')).toBeNull();
    expect(inviteCodeFrom('')).toBeNull();
  });
});

describe('describeOpponentGone', () => {
  it('says how long the opponent has been gone, once it is a minute or more', () => {
    expect(describeOpponentGone(0, 30_000)).toBe('Your opponent lost connection. Waiting for them to come back…');
    expect(describeOpponentGone(0, 3 * 60_000 + 5_000)).toBe(
      'Your opponent lost connection 3 min ago. Waiting for them to come back…',
    );
    expect(describeOpponentGone(null, 10 * 60_000)).toBe('Your opponent lost connection. Waiting for them to come back…');
  });
});

describe('describeGameOver online, when the game ended off the board', () => {
  const online = { ...defaultSettings(), mode: 'online' as const, playerSide: LIGHT };

  it('says who resigned', () => {
    expect(describeGameOver({ kind: 'win', winner: LIGHT }, online, 'resigned')).toMatchObject({ title: 'You win!', subtitle: 'Your opponent resigned.' });
    expect(describeGameOver({ kind: 'win', winner: DARK }, online, 'resigned')).toMatchObject({ title: 'You lose', subtitle: 'You resigned.' });
  });

  it('a draw by agreement, and a claimed win', () => {
    expect(describeGameOver({ kind: 'draw' }, online, 'draw_agreed')).toMatchObject({ title: 'Draw', subtitle: 'Draw by agreement.' });
    expect(describeGameOver({ kind: 'win', winner: LIGHT }, online, 'abandoned')?.subtitle).toBe("Your opponent didn't come back.");
  });
});

describe('running out of time', () => {
  const settings = defaultSettings();
  const timeouts = { light: 1, dark: 2 };

  it('says whose turn was skipped, and how many in a row', () => {
    expect(describeTimeout(LIGHT, timeouts, { ...settings, mode: 'computer', playerSide: LIGHT })).toBe(
      'You ran out of time: your turn was skipped. Time-outs in a row: 1 of 3.',
    );
    expect(describeTimeout(DARK, timeouts, { ...settings, mode: 'online', playerSide: LIGHT })).toBe(
      'Opponent ran out of time: your move again. Time-outs in a row: 2 of 3.',
    );
    expect(describeTimeout(DARK, timeouts, { ...settings, mode: 'pvp' })).toBe('Black ran out of time: White to move. Time-outs in a row: 2 of 3.');
    expect(describeTimeout(null, timeouts, settings)).toBeNull();
    expect(describeTimeout(LIGHT, timeouts, settings, false)).toBeNull(); // the game is over: the card says it
  });

  it('a game lost on time says so', () => {
    const onTime = { kind: 'win', winner: LIGHT, onTime: true } as const;
    expect(describeGameOver(onTime, { ...settings, mode: 'online', playerSide: LIGHT })?.subtitle).toBe('Your opponent ran out of time 3 turns in a row.');
    expect(describeGameOver(onTime, { ...settings, mode: 'computer', playerSide: DARK })?.subtitle).toBe('You ran out of time 3 turns in a row.');
    expect(describeGameOver(onTime, { ...settings, mode: 'pvp' })?.subtitle).toBe('Black ran out of time 3 turns in a row.');
  });
});
