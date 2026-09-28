import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { styleText } from 'node:util';
import { createJsonRenderExample } from '@devkit/example-json-render';
import { createServer } from 'vite';

const mode = process.argv[2] ?? 'devframe';
if (mode !== 'devframe' && mode !== 'devtools') throw new Error('Choose devframe or devtools');
await using cleanup = new AsyncDisposableStack();
const example = await createJsonRenderExample(mode);
cleanup.defer(example.close);
const server = await createServer({
  configFile: false,
  root: fileURLToPath(new URL('../browser/', import.meta.url)),
  define: { DEMO_AUTH_TOKEN: JSON.stringify(example.host.token) },
  server: {
    host: '127.0.0.1',
    port: 0,
    proxy: { '/__devkit-remote/': { target: example.host.origin, ws: true } },
  },
});
cleanup.defer(() => server.close());
await server.listen();
console.info(styleText('cyan', '🚀 [json-render]'), mode, server.resolvedUrls?.local);
const terminal = createInterface({ input: process.stdin, output: process.stdout });
cleanup.defer(() => {
  terminal.close();
});
await terminal.question('Press Enter to close the renderer example.\n');
