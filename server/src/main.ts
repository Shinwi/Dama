import { DEFAULT_SERVER_PORT } from '../../web/src/protocol/online';
import { createDamaServer } from './server';

const port = Number(process.env['PORT'] ?? DEFAULT_SERVER_PORT);
// Which web pages may connect. Any origin by default, which is fine on your own machine;
// set CORS_ORIGIN (comma-separated) when this is hosted.
const corsOrigin = process.env['CORS_ORIGIN']?.split(',').map((o) => o.trim()) ?? true;

const server = createDamaServer({ corsOrigin });
server.http.listen(port, () => {
  console.log(`Dama server listening on http://localhost:${port}`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void server.close().then(() => process.exit(0));
  });
}
