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
  const button = (name: string) => [...el().querySelectorAll('button')].find((b) => b.textContent?.trim() === name);
  const pressed = () => el().querySelector('[aria-label="Opponent"] [aria-pressed="true"]')?.textContent?.trim();

  it('shows Online only once the server has answered', async () => {
    await show('checking');
    expect(button('Online')).toBeUndefined();
    await show('down');
    expect(button('Online')).toBeUndefined();
    await show('up');
    expect(button('Online')).toBeDefined();
  });

  it('falls back to Vs computer when the last game was online but the server is not there', async () => {
    await show('down', { mode: 'online' });
    expect(pressed()).toBe('Vs computer');
    expect(button('Start game')).toBeDefined();

    // The server turns up while the home screen is open: Online comes back.
    await show('up');
    expect(pressed()).toBe('Online');
  });

  it("keeps the player's own pick when the server turns up later", async () => {
    await show('checking', { mode: 'online' });
    button('1v1')!.click();
    await show('up');
    expect(pressed()).toBe('1v1');
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
});
