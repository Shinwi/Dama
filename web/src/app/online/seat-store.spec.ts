import { SEAT_MAX_AGE_MS, SeatStore } from './seat-store';

/** A Map standing in for localStorage. */
function memoryStorage() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  };
}

describe('SeatStore', () => {
  it('remembers the seat to go back to, across new instances (a reopened page)', () => {
    const storage = memoryStorage();
    new SeatStore(storage).enter({ code: 'k7qx', token: 'secret' });
    expect(new SeatStore(storage).current()).toEqual({ code: 'K7QX', token: 'secret' });
  });

  it('after leaving on purpose, does not go back in, but still knows the seat by its code', () => {
    const store = new SeatStore(memoryStorage());
    store.enter({ code: 'K7QX', token: 'secret' });
    store.leave();
    expect(store.current()).toBeNull();
    expect(store.seatIn(' k7qx ')).toEqual({ code: 'K7QX', token: 'secret' });
  });

  it('forgets a seat whose room is gone', () => {
    const storage = memoryStorage();
    const store = new SeatStore(storage);
    store.enter({ code: 'K7QX', token: 'secret' });
    store.forget('K7QX');
    expect(store.current()).toBeNull();
    expect(store.seatIn('K7QX')).toBeNull();
    expect(storage.data.size).toBe(0); // nothing left behind
  });

  it('keeps several seats, the latest one being the game to go back to', () => {
    const store = new SeatStore(memoryStorage());
    store.enter({ code: 'AAAA', token: 'one' });
    store.enter({ code: 'BBBB', token: 'two' });
    expect(store.current()?.code).toBe('BBBB');
    expect(store.seatIn('AAAA')?.token).toBe('one');
  });

  it('forgets seats not used for a day', () => {
    let time = 0;
    const store = new SeatStore(memoryStorage(), () => time);
    store.enter({ code: 'K7QX', token: 'secret' });
    time = SEAT_MAX_AGE_MS + 1;
    expect(store.current()).toBeNull();
    expect(store.seatIn('K7QX')).toBeNull();
  });

  it('copes with no storage and with rubbish in it', () => {
    const none = new SeatStore(null);
    none.enter({ code: 'K7QX', token: 'secret' });
    expect(none.current()).toBeNull();

    const storage = memoryStorage();
    storage.setItem('dama.online.seats.v1', '{not json');
    expect(new SeatStore(storage).current()).toBeNull();
  });
});
