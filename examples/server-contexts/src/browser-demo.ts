import { createInterface } from 'node:readline/promises';
import { styleText } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { createRemoteHost } from '@devkit/example-server-contexts';

const mode = process.argv[2] ?? 'devframe';
if (mode !== 'devframe' && mode !== 'devtools') throw new Error('Choose devframe or devtools');
await using cleanup = new AsyncDisposableStack();
const host = await createRemoteHost(mode);
cleanup.defer(host.close);
const server = await createServer({
  configFile: false,
  root: fileURLToPath(new URL('../browser/', import.meta.url)),
  define: { DEMO_AUTH_TOKEN: JSON.stringify(host.token) },
  server: {
    host: '127.0.0.1',
    port: 0,
    proxy: { '/__devkit-remote/': { target: host.origin, ws: true } },
  },
});
cleanup.defer(() => server.close());
await server.listen();
console.info(styleText('cyan', '🚀 [remote-browser]'), mode, server.resolvedUrls?.local);
const terminal = createInterface({ input: process.stdin, output: process.stdout });
cleanup.defer(() => {
  terminal.close();
});
await terminal.question('Press Enter to stop the demo.\n');
