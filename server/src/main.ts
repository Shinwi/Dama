import { DEFAULT_SERVER_PORT } from '../../web/src/protocol/online';
import { createMetricsServer } from './metrics';
import { createDamaServer, jsonLogger } from './server';

const port = Number(process.env['PORT'] ?? DEFAULT_SERVER_PORT);
// Prometheus metrics, on a port of their own that only Fly's network reaches.
const metricsPort = Number(process.env['METRICS_PORT'] ?? 9091);
// Which web pages may connect. Any origin by default, which is fine on your own machine;
// set CORS_ORIGIN (comma-separated) when this is hosted.
const allowedOrigins = process.env['CORS_ORIGIN']?.split(',').map((o) => o.trim()).filter(Boolean) ?? true;

const server = createDamaServer({ allowedOrigins });
server.http.listen(port, () => {
  const who = allowedOrigins === true ? 'any origin' : allowedOrigins.join(', ');
  jsonLogger('server_started', { port, metricsPort, accepting: who });
});
const metricsServer = createMetricsServer(server.metrics);
metricsServer.listen(metricsPort);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    jsonLogger('server_stopping', { signal, rooms: server.rooms.size });
    metricsServer.close();
    void server.close().then(() => process.exit(0));
  });
}
