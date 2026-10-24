import { playerId } from './player-id';

function memoryStorage() {
  const data = new Map<string, string>();
  return { data, getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
}

describe('playerId', () => {
  it('is made once, then the same every time', () => {
    const storage = memoryStorage();
    const first = playerId(storage);
    expect(first).toMatch(/^[A-Za-z0-9-]{8,64}$/);
    expect(playerId(storage)).toBe(first);
    expect(storage.data.get('dama.player.v1')).toBe(first);
  });

  it('replaces something that is not a valid ID', () => {
    const storage = memoryStorage();
    storage.setItem('dama.player.v1', 'nope');
    expect(playerId(storage, () => 'abcdef12-3456')).toBe('abcdef12-3456');
  });

  it('still works without storage', () => {
    expect(playerId(null, () => 'abcdef12-3456')).toBe('abcdef12-3456');
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(playerId(broken, () => 'abcdef12-3456')).toBe('abcdef12-3456');
  });
});
