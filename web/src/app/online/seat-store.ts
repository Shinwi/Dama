/** A seat in an online room: the room's code and the secret token that proves it's yours. */
export interface Seat {
  code: string;
  token: string;
}

interface StoredSeats {
  /** The game to go back to when the site is opened again. Null after leaving on purpose. */
  current: string | null;
  /** Every seat this browser holds, by room code, with when it was last used. */
  seats: Record<string, { token: string; usedAt: number }>;
}

const STORAGE_KEY = 'dama.online.seats.v1';
/** Seats not used for this long are forgotten (rooms are long gone by then). */
export const SEAT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * The online seats this browser holds, in localStorage. localStorage, not sessionStorage,
 * because iPhone Safari empties a tab's sessionStorage when it's closed: the player then lost
 * their seat, and their own room said "full" (issue #39). The flip side: every tab of this
 * browser is the same player. Fails quietly when storage is unavailable.
 */
export class SeatStore {
  constructor(
    private readonly storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null = safeLocalStorage(),
    private readonly now: () => number = Date.now,
  ) {}

  /** The game to go back to on opening the site, if any. */
  current(): Seat | null {
    const stored = this.read();
    const code = stored.current;
    const seat = code ? stored.seats[code] : undefined;
    return code && seat ? { code, token: seat.token } : null;
  }

  /** The seat this browser holds in room `code`, if any. */
  seatIn(code: string): Seat | null {
    const key = normalize(code);
    const seat = this.read().seats[key];
    return seat ? { code: key, token: seat.token } : null;
  }

  /** Remembers a seat and makes it the game to go back to. */
  enter(seat: Seat): void {
    const stored = this.read();
    const key = normalize(seat.code);
    stored.seats[key] = { token: seat.token, usedAt: this.now() };
    stored.current = key;
    this.write(stored);
  }

  /** Left on purpose: don't jump back in on opening the site, but keep the seat for its code. */
  leave(): void {
    const stored = this.read();
    stored.current = null;
    this.write(stored);
  }

  /** The room is gone: forget the seat altogether. */
  forget(code: string): void {
    const stored = this.read();
    const key = normalize(code);
    delete stored.seats[key];
    if (stored.current === key) stored.current = null;
    this.write(stored);
  }

  private read(): StoredSeats {
    const empty: StoredSeats = { current: null, seats: {} };
    try {
      const raw = this.storage?.getItem(STORAGE_KEY);
      const stored = raw ? (JSON.parse(raw) as StoredSeats) : empty;
      // Forget seats nobody has used for a day.
      const cutoff = this.now() - SEAT_MAX_AGE_MS;
      for (const [code, seat] of Object.entries(stored.seats ?? {})) {
        if (!seat || typeof seat.token !== 'string' || seat.usedAt < cutoff) delete stored.seats[code];
      }
      return { current: stored.current ?? null, seats: stored.seats ?? {} };
    } catch {
      return empty;
    }
  }

  private write(stored: StoredSeats): void {
    try {
      if (Object.keys(stored.seats).length === 0) this.storage?.removeItem(STORAGE_KEY);
      else this.storage?.setItem(STORAGE_KEY, JSON.stringify(stored));
    } catch {
      // Private browsing / quota exceeded: the seat just won't survive closing the page.
    }
  }
}

function normalize(code: string): string {
  return code.trim().toUpperCase();
}

function safeLocalStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
