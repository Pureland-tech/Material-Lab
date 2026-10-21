import { createApp } from './app';
import { loadConfig } from './config';

const config = loadConfig();
const app = createApp(config, {
  // Route patterns, not raw paths: share and invite tokens never reach the logs.
  onRequest: ({ method, route, status, ms }) => console.log(`${method} ${route} ${status} ${ms.toFixed(0)}ms`),
});

app.server.listen(config.port, config.host, () => {
  console.log(`Material Lab API on http://${config.host}:${config.port} (AI suggestions: ${app.services.suggester ? `on, ${config.ai.model}` : 'off — built-in matcher'})`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void app.close().then(() => process.exit(0));
  });
}
