/** A link that opens the game on "Join room" with the code filled in. */
export function inviteLink(code: string): string {
  return `${location.origin}${location.pathname}?room=${code}`;
}

/** Phones (and some desktops) can hand the invite to WhatsApp, SMS, … through the share sheet. */
export function canShare(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.share === 'function';
}

/**
 * The share sheet where there is one; otherwise the link goes on the clipboard. Says what
 * happened: 'shared' (or the sheet was closed), 'copied', or 'failed' (no clipboard either,
 * e.g. plain http on a phone: the code is on screen to read out instead).
 */
export async function shareInvite(code: string): Promise<'shared' | 'copied' | 'failed'> {
  const url = inviteLink(code);
  if (canShare()) {
    try {
      await navigator.share({ title: 'Dama', text: `Play dama with me! Room ${code}:`, url });
      return 'shared';
    } catch (error) {
      // Closing the share sheet isn't a failure; anything else falls back to copying.
      if (error instanceof DOMException && error.name === 'AbortError') return 'shared';
    }
  }
  return copyText(url);
}

export async function copyText(text: string): Promise<'copied' | 'failed'> {
  try {
    await navigator.clipboard.writeText(text);
    return 'copied';
  } catch {
    return 'failed';
  }
}
