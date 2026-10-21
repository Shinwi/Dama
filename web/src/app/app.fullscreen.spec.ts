import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { App } from './app';
import { defaultSettings } from './game/game-controller';

describe('App full screen (3D board)', () => {
  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideZonelessChangeDetection()],
    }).compileComponents();
  });

  it('fills the window where real full screen is unavailable, and Esc leaves it', async () => {
    // jsdom has no Fullscreen API, like Safari on iPhone.
    const fixture = TestBed.createComponent(App);
    fixture.componentInstance.startGame(defaultSettings());
    fixture.detectChanges();
    const column = () => fixture.nativeElement.querySelector('.board-column') as HTMLElement;

    fixture.componentInstance.toggleFullscreen();
    await fixture.whenStable();
    expect(column().classList).toContain('fullscreen');
    expect(column().classList).toContain('fill-window');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await fixture.whenStable();
    expect(column().classList).not.toContain('fullscreen');
  });

  it('leaves the fallback with the button too', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.componentInstance.startGame(defaultSettings());
    fixture.detectChanges();
    fixture.componentInstance.toggleFullscreen();
    fixture.componentInstance.toggleFullscreen();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.board-column').classList).not.toContain('fullscreen');
  });
});
