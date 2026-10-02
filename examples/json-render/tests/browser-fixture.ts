import { fileURLToPath } from 'node:url';
import type { createJsonRenderExample } from '@devkit/example-json-render';
import { createServer } from 'vite';

export async function serve(example: Awaited<ReturnType<typeof createJsonRenderExample>>) {
  const server = await createServer({
    configFile: false,
    root: fileURLToPath(new URL('../browser/', import.meta.url)),
    logLevel: 'silent',
    define: { DEMO_AUTH_TOKEN: JSON.stringify(example.host.token) },
    server: {
      host: '127.0.0.1',
      port: 0,
      proxy: { '/__devkit-remote/': { target: example.host.origin, ws: true } },
    },
  });
  await server.listen();
  return server;
}
