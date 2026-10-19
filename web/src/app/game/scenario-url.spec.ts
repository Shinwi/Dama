import { readPositionParam, withoutPositionParam } from './scenario-url';

describe('scenario-url', () => {
  it('reads the position code, with its ; : , separators intact', () => {
    expect(readPositionParam('?position=L:c3,Ke5;D:f6;t:D')).toBe('L:c3,Ke5;D:f6;t:D');
    expect(readPositionParam('?position=L%3Ac3%3BD%3Af6')).toBe('L:c3;D:f6');
  });

  it('returns null when there is no position param', () => {
    expect(readPositionParam('')).toBeNull();
    expect(readPositionParam('?foo=1')).toBeNull();
  });

  it('removes only the position param', () => {
    expect(withoutPositionParam('http://x.test/dama/?position=L:c3')).toBe('http://x.test/dama/');
    expect(withoutPositionParam('http://x.test/?a=1&position=L:c3#h')).toBe('http://x.test/?a=1#h');
  });
});
