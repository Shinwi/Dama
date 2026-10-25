import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { GameOverCard } from './game-over-card';

describe('GameOverCard', () => {
  let fixture: ComponentFixture<GameOverCard>;
  const buttons = () => [...fixture.nativeElement.querySelectorAll('button')].map((b: HTMLButtonElement) => b.textContent?.trim());
  const status = () => fixture.nativeElement.querySelector('[data-testid="rematch-status"]')?.textContent?.trim() ?? null;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [GameOverCard], providers: [provideZonelessChangeDetection()] }).compileComponents();
    fixture = TestBed.createComponent(GameOverCard);
    fixture.componentRef.setInput('info', { variant: 'win', title: 'You win!', subtitle: 'Your opponent resigned.' });
  });

  async function show(rematch: { you: boolean; opponent: boolean } | null) {
    fixture.componentRef.setInput('rematch', rematch);
    await fixture.whenStable();
  }

  it('offline: New game', async () => {
    await show(null);
    expect(buttons()).toEqual(['New game']);
  });

  it('online: Rematch or Back to menu', async () => {
    await show({ you: false, opponent: false });
    expect(buttons()).toEqual(['Rematch', 'Back to menu']);
    expect(status()).toBeNull();
  });

  it("online: answering the opponent's request", async () => {
    await show({ you: false, opponent: true });
    expect(status()).toBe('Your opponent wants a rematch.');
    expect(buttons()).toEqual(['Rematch', 'No thanks']);
    const answers: boolean[] = [];
    fixture.componentInstance.answerRematch.subscribe((yes) => answers.push(yes));
    (fixture.nativeElement.querySelectorAll('button')[1] as HTMLButtonElement).click();
    expect(answers).toEqual([false]);
  });

  it('online: waiting for the answer to your request', async () => {
    await show({ you: true, opponent: false });
    expect(status()).toBe('Rematch asked. Waiting for your opponent…');
    expect(buttons()).toEqual(['Cancel', 'Back to menu']);
  });

  it('focus() puts focus on the main button', async () => {
    await show({ you: false, opponent: false });
    document.body.appendChild(fixture.nativeElement);
    fixture.componentInstance.focus();
    expect(document.activeElement?.textContent?.trim()).toBe('Rematch');
    fixture.nativeElement.remove();
  });
});
