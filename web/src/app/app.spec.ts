import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { App } from './app';

describe('App', () => {
  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideZonelessChangeDetection()],
    }).compileComponents();
  });

  it('renders the 40 starting pieces', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const pieces = fixture.nativeElement.querySelectorAll('[data-testid="piece"]');
    expect(pieces.length).toBe(40);
  });

  it('shows "Your move." for Light to move at the start', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const status = fixture.nativeElement.querySelector('[data-testid="status"]');
    expect(status.textContent).toContain('Your move.');
  });
});
