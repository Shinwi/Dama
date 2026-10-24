import { checkOnlineServer, onlineServerUrl } from './online-client';
import { HOSTED_SERVER_URL } from './server-config';

const answer = (body: unknown, status = 200) =>
  (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe('checkOnlineServer', () => {
  it("is true when the server's /health says ok", async () => {
    let asked = '';
    const fetchFn = (async (url: string) => {
      asked = url;
      return new Response(JSON.stringify({ ok: true }));
    }) as unknown as typeof fetch;
    expect(await checkOnlineServer('http://localhost:3000/', 1000, fetchFn)).toBe(true);
    expect(asked).toBe('http://localhost:3000/health');
  });

  it('is false for an error status, or an answer that is not the server', async () => {
    expect(await checkOnlineServer('http://x', 1000, answer({ ok: true }, 503))).toBe(false);
    expect(await checkOnlineServer('http://x', 1000, answer({ hello: 'world' }))).toBe(false);
    const notJson = (async () => new Response('<html>')) as unknown as typeof fetch;
    expect(await checkOnlineServer('http://x', 1000, notJson)).toBe(false);
  });

  it('is false when nothing is listening', async () => {
    const refused = (async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    expect(await checkOnlineServer('http://x', 1000, refused)).toBe(false);
  });

  it('is false when the server does not answer in time', async () => {
    // Hangs until the check gives up and aborts it.
    const hangs = ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))))) as unknown as typeof fetch;
    expect(await checkOnlineServer('http://x', 20, hangs)).toBe(false);
  });
});

describe('onlineServerUrl', () => {
  it('is the hosted server on an https page (the live site)', () => {
    expect(onlineServerUrl({ search: '', protocol: 'https:', hostname: 'shinwi.github.io' })).toBe(HOSTED_SERVER_URL);
    expect(HOSTED_SERVER_URL).toMatch(/^https:\/\//);
  });

  it('is port 3000 on the host the page came from over http, unless ?server= says otherwise', () => {
    expect(onlineServerUrl({ search: '', protocol: 'http:', hostname: '192.168.1.20' })).toBe('http://192.168.1.20:3000');
    expect(onlineServerUrl({ search: '?server=http://localhost:3001', protocol: 'http:', hostname: 'localhost' })).toBe(
      'http://localhost:3001',
    );
  });
});
