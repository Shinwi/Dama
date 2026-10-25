import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { defaultSettings } from '../game/game-controller';
import { OnlineServerState } from '../game/game.service';
import { Home } from './home';

describe('Home and the online server', () => {
  let fixture: ComponentFixture<Home>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Home],
      providers: [provideZonelessChangeDetection()],
    }).compileComponents();
    fixture = TestBed.createComponent(Home);
    fixture.componentRef.setInput('settings', defaultSettings());
  });

  async function show(server: OnlineServerState, extra: { mode?: 'online'; inviteCode?: string } = {}) {
    if (extra.mode) fixture.componentRef.setInput('settings', { ...defaultSettings(), mode: extra.mode });
    if (extra.inviteCode) fixture.componentRef.setInput('inviteCode', extra.inviteCode);
    fixture.componentRef.setInput('onlineServer', server);
    await fixture.whenStable();
  }

  const el = () => fixture.nativeElement as HTMLElement;
  /** The opponent picked, by its data-mode (each design words the options its own way). */
  const pressed = () => el().querySelector('[data-mode][aria-pressed="true"]')?.getAttribute('data-mode');
  const modeButton = (mode: string) => el().querySelector<HTMLButtonElement>(`[data-mode="${mode}"]`) ?? undefined;
  const startButton = () => el().querySelector<HTMLButtonElement>('[data-testid="start"]') ?? undefined;

  it('shows Online only once the server has answered', async () => {
    await show('checking');
    expect(modeButton('online')).toBeUndefined();
    await show('down');
    expect(modeButton('online')).toBeUndefined();
    await show('up');
    expect(modeButton('online')).toBeDefined();
  });

  it('falls back to Vs computer when the last game was online but the server is not there', async () => {
    await show('down', { mode: 'online' });
    expect(pressed()).toBe('computer');
    expect(startButton()).toBeDefined();

    // The server turns up while the home screen is open: Online comes back.
    await show('up');
    expect(pressed()).toBe('online');
  });

  it("keeps the player's own pick when the server turns up later", async () => {
    await show('checking', { mode: 'online' });
    modeButton('pvp')!.click();
    await show('up');
    expect(pressed()).toBe('pvp');
  });

  it('explains an invite link that cannot be used', async () => {
    await show('down', { inviteCode: 'K7QX' });
    expect(el().querySelector('[data-testid="online-unavailable"]')?.textContent).toContain(
      "Online games aren't available right now.",
    );
    expect(el().querySelector('[data-testid="room-code-input"]')).toBeNull();
  });

  it('opens an invite link on "Join room" when the server is there', async () => {
    await show('up', { inviteCode: 'K7QX' });
    expect(el().querySelector('[data-testid="online-unavailable"]')).toBeNull();
    expect((el().querySelector('[data-testid="room-code-input"]') as HTMLInputElement).value).toBe('K7QX');
  });

  it('picks a move timer, except when joining a room (the room has its own)', async () => {
    await show('up');
    const emitted: unknown[] = [];
    fixture.componentInstance.start.subscribe((setup) => emitted.push(setup.moveTime));
    const timer = () => el().querySelector('[aria-label="Move timer"]');
    expect(timer()?.querySelector('[aria-pressed="true"]')?.getAttribute('data-move-time')).toBe('30');
    el().querySelector<HTMLButtonElement>('[data-move-time="60"]')!.click();
    startButton()!.click();
    expect(emitted).toEqual([60]);

    modeButton('online')!.click();
    await fixture.whenStable();
    expect(timer()).not.toBeNull(); // creating a room
    el().querySelector<HTMLButtonElement>('[data-entry="join"]')!.click();
    await fixture.whenStable();
    expect(timer()).toBeNull();
  });
});
