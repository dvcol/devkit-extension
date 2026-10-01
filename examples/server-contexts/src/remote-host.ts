import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { initHub } from '@devframes/hub/initiate';
import type { InitHubOptions } from '@devframes/hub/initiate';
import { createInteractiveAuth } from 'devframe/recipes/interactive-auth';

import { registerRemoteProbes } from './remote-probes.js';
import { createRemoteContext, remoteComposition } from './remote-context.js';
import { publishCounterStorage } from './counter-storage.js';

interface RemoteHostOptions extends Pick<InitHubOptions, 'renderers' | 'allowedOrigins'> {
  readonly providerId?: string;
  /** Opt into native debounced persistence. The caller owns this file; closing never removes it. */
  readonly counterStoragePath?: string;
}

/** Example-owned HTTP/RPC lifetime; contribution disposal does not remove host RPC definitions. */
export async function createRemoteHost(
  mode: 'devframe' | 'devtools',
  options: RemoteHostOptions = {},
) {
  const directory = await mkdtemp(join(tmpdir(), 'devkit-remote-example-'));
  await using cleanup = new AsyncDisposableStack();
  cleanup.defer(() => rm(directory, { recursive: true, force: true }));

  const { context: nativeContext, createProvider } = await createRemoteContext(mode, directory);
  const token = randomUUID();
  const hub = initHub({
    context: nativeContext,
    renderers: options.renderers ?? [],
    allowedOrigins: options.allowedOrigins ?? [],
    base: '/__devkit-remote/',
    auth: createInteractiveAuth(nativeContext, { clientAuthTokens: [token], banner() {} }),
    register: false,
    mcp: false,
    sse: false,
  });
  const server = createHttpServer(hub);
  cleanup.defer(() => closeServer(server));
  cleanup.defer(() => hub.close());
  cleanup.defer(hub.attach(server));
  await hub.ready;
  const composition = await prepareRemoteComposition(nativeContext, options);
  const provider = await createProvider(composition);
  cleanup.defer(() => provider.dispose());
  const probes = registerRemoteProbes(nativeContext);
  let currentProvider = provider;
  const origin = await listen(server);
  const lifetime = cleanup.move();
  return {
    context: nativeContext,
    hub,
    provider,
    probes,
    token,
    url: `${origin.replace('http:', 'ws:')}/__devkit-remote/__ws`,
    origin,
    async replace() {
      await currentProvider.dispose();
      const successor = await createProvider(composition);
      lifetime.defer(() => successor.dispose());
      currentProvider = successor;
      return successor;
    },
    close: () => lifetime.disposeAsync(),
  };
}

async function prepareRemoteComposition(
  context: Parameters<typeof publishCounterStorage>[0],
  options: RemoteHostOptions,
) {
  if (options.counterStoragePath !== undefined)
    await publishCounterStorage(context, options.counterStoragePath);
  return { ...remoteComposition, providerId: options.providerId ?? remoteComposition.providerId };
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('Missing HTTP address');
  return `http://127.0.0.1:${address.port}`;
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function createHttpServer(hub: ReturnType<typeof initHub>): Server {
  return createServer((request, response) => {
    hub.nodeMiddleware(request, response, () => {
      response.end('host-alive');
    });
  });
}
