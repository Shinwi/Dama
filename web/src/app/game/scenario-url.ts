/**
 * The dev-only `?position=<code>` deep link (see engine/position.ts for the code format).
 * Pure string helpers, so they're testable without touching the real window location.
 */
export const POSITION_PARAM = 'position';

export function readPositionParam(search: string): string | null {
  return new URLSearchParams(search).get(POSITION_PARAM);
}

export function withoutPositionParam(href: string): string {
  const url = new URL(href);
  url.searchParams.delete(POSITION_PARAM);
  return url.toString();
}
