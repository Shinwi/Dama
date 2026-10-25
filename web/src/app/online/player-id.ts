const STORAGE_KEY = 'dama.player.v1';

/**
 * This browser's anonymous player ID: a random UUID made on the device the first time it's
 * needed, then kept. Nothing personal: the server only uses it to count different players
 * per day. Without storage (e.g. private browsing that blocks it), a new one per page load.
 */
export function playerId(
  storage: Pick<Storage, 'getItem' | 'setItem'> | null = safeLocalStorage(),
  random: () => string = randomId,
): string {
  try {
    const existing = storage?.getItem(STORAGE_KEY);
    if (existing && /^[A-Za-z0-9-]{8,64}$/.test(existing)) return existing;
  } catch {
    // Storage unavailable: fall through to a fresh one.
  }
  const id = random();
  try {
    storage?.setItem(STORAGE_KEY, id);
  } catch {
    // Can't keep it: this page load just counts as a new player.
  }
  return id;
}

function randomId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // Older browsers: 128 random bits as hex, from crypto if there is one.
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function safeLocalStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
