import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { LIGHT } from '../../engine/types';
import { OnlineStatus } from '../game/game.service';
import { RoomPanel } from './room-panel';

const status: OnlineStatus = {
  code: 'K7QX',
  side: LIGHT,
  opponentJoined: false,
  opponentConnected: false,
  connection: 'connected',
  error: null,
  opponentGoneSince: null,
  game: 0,
  result: null,
  drawOffer: null,
  rematch: { you: false, opponent: false },
  claimWinAt: null,
};

describe('RoomPanel invite', () => {
  const realShare = Object.getOwnPropertyDescriptor(navigator, 'share');
  const realClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  afterEach(() => {
    if (realShare) Object.defineProperty(navigator, 'share', realShare);
    else delete (navigator as { share?: unknown }).share;
    if (realClipboard) Object.defineProperty(navigator, 'clipboard', realClipboard);
  });

  async function panel() {
    await TestBed.configureTestingModule({ imports: [RoomPanel], providers: [provideZonelessChangeDetection()] }).compileComponents();
    const fixture = TestBed.createComponent(RoomPanel);
    fixture.componentRef.setInput('status', status);
    await fixture.whenStable();
    return fixture;
  }

  it('opens the share sheet where there is one, with the code and the link', async () => {
    const shared: ShareData[] = [];
    Object.defineProperty(navigator, 'share', { configurable: true, value: async (data: ShareData) => void shared.push(data) });
    const fixture = await panel();
    const button = fixture.nativeElement.querySelector('[data-testid="share-invite"]') as HTMLButtonElement;
    expect(button.textContent?.trim()).toBe('Share invite');
    button.click();
    await fixture.whenStable();
    expect(shared).toHaveLength(1);
    expect(shared[0].text).toContain('Room K7QX');
    expect(shared[0].url).toContain('?room=K7QX');
  });

  it('copies the link where there is no share sheet', async () => {
    delete (navigator as { share?: unknown }).share;
    const copied: string[] = [];
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => void copied.push(text) } });
    const fixture = await panel();
    const button = fixture.nativeElement.querySelector('[data-testid="share-invite"]') as HTMLButtonElement;
    expect(button.textContent?.trim()).toBe('Copy invite link');
    button.click();
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();
    expect(copied[0]).toContain('?room=K7QX');
    expect(button.textContent?.trim()).toBe('Link copied');
  });
});
