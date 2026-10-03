import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import type { Plugin } from 'vite';

export const inspectorDevelopmentChecks = [
  'a valid inspector main-module edit causes native Vite document reload while retaining provider and business state',
  'a genuine syntax error shows the native overlay with zero inspector mounts and a disabled renderer selector',
  'valid source recovery remounts the unchanged authored view once with retained state and no response replay',
  'each explicit Inspect action after reload or repair produces exactly one real owned HTTP request',
];

/** The maintained config owns both native hosts; only copied browser source is edited. */
export async function inspectorDevelopmentFixture(host: 'devframe' | 'devtools') {
  await using cleanup = new AsyncDisposableStack();
  await mkdir('artifacts', { recursive: true });
  const directory = await mkdtemp(join('artifacts', 'inspector-development-'));
  cleanup.defer(() => rm(directory, { recursive: true, force: true }));
  const root = fileURLToPath(new URL(`../${directory}/site`, import.meta.url));
  await cp(fileURLToPath(new URL('../inspector-site', import.meta.url)), root, { recursive: true });
  const observer = responseObserver();
  const server = await createServer({
    configFile: fileURLToPath(new URL('../inspector.config.ts', import.meta.url)),
    root,
    mode: host,
    logLevel: 'silent',
    plugins: [observer.plugin],
    server: { host: '127.0.0.1', port: 0 },
  });
  cleanup.defer(() => server.close());
  await server.listen();
  const address = server.httpServer?.address();
  assert.ok(address !== undefined && address !== null && typeof address !== 'string');
  const sourcePath = join(root, 'main.ts');
  const source = await readFile(sourcePath, 'utf8');
  const lifetime = cleanup.move();
  return {
    host,
    origin: `http://127.0.0.1:${address.port}`,
    requests: observer.requests,
    edit: (label: string) =>
      writeFile(
        sourcePath,
        `${source}\ndocument.querySelector('h1')!.textContent = ${JSON.stringify(label)};\n`,
      ),
    invalidate: () => writeFile(sourcePath, `${source}\nexport const invalidInspector = ;\n`),
    close: () => lifetime.disposeAsync(),
  };
}

function responseObserver() {
  const requests: { url: string; completed: boolean }[] = [];
  const plugin: Plugin = {
    name: 'test:observe-inspector-development-responses',
    enforce: 'pre',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.url === '/inspector-response') {
          const observation = { url: request.url, completed: false };
          requests.push(observation);
          response.once('finish', () => {
            observation.completed = true;
          });
        }
        next();
      });
    },
  };
  return { requests, plugin };
}
