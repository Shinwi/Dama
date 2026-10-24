import { DEFAULT_SERVER_PORT } from '../../web/src/protocol/online';
import { createDamaServer } from './server';

const port = Number(process.env['PORT'] ?? DEFAULT_SERVER_PORT);
// Which web pages may connect. Any origin by default, which is fine on your own machine;
// set CORS_ORIGIN (comma-separated) when this is hosted.
const allowedOrigins = process.env['CORS_ORIGIN']?.split(',').map((o) => o.trim()).filter(Boolean) ?? true;

const server = createDamaServer({ allowedOrigins });
server.http.listen(port, () => {
  const who = allowedOrigins === true ? 'any origin' : allowedOrigins.join(', ');
  console.log(`Dama server listening on http://localhost:${port} (accepting ${who})`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void server.close().then(() => process.exit(0));
  });
}
